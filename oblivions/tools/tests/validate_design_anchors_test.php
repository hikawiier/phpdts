<?php

require_once dirname(__DIR__) . '/validate_design_anchors.php';

class DesignAnchorTestFailure extends RuntimeException {}

function da_test_assert($condition, $message) {
    if (!$condition) {
        throw new DesignAnchorTestFailure($message);
    }
}

function da_test_assert_same($expected, $actual, $message) {
    if ($expected !== $actual) {
        throw new DesignAnchorTestFailure(
            $message . ' (expected ' . var_export($expected, true) . ', got ' . var_export($actual, true) . ')'
        );
    }
}

function da_test_codes($report) {
    return array_map(function ($issue) {
        return $issue['code'];
    }, $report['errors']);
}

function da_test_assert_has_code($report, $code) {
    da_test_assert(in_array($code, da_test_codes($report), true), 'expected issue code ' . $code);
}

function da_test_assert_no_code($report, $code) {
    da_test_assert(!in_array($code, da_test_codes($report), true), 'did not expect issue code ' . $code);
}

function da_test_write($root, $relativePath, $content) {
    $path = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0777, true) && !is_dir($directory)) {
        throw new RuntimeException('unable to create fixture directory: ' . $directory);
    }
    if (file_put_contents($path, $content) === false) {
        throw new RuntimeException('unable to write fixture file: ' . $path);
    }
}

function da_test_fixture($suiteRoot, $name, $dian, $files = array()) {
    $root = $suiteRoot . DIRECTORY_SEPARATOR . $name;
    if (!mkdir($root, 0777, true) && !is_dir($root)) {
        throw new RuntimeException('unable to create fixture root: ' . $root);
    }
    da_test_write($root, 'oblivions/DESIGN.md', "# Design\n");
    da_test_write($root, 'oblivions/Dian.md', $dian);
    $frontendRoot = $root . DIRECTORY_SEPARATOR . 'vex-vue' . DIRECTORY_SEPARATOR . 'src';
    if (!mkdir($frontendRoot, 0777, true) && !is_dir($frontendRoot)) {
        throw new RuntimeException('unable to create frontend fixture root');
    }
    foreach ($files as $path => $content) {
        da_test_write($root, $path, $content);
    }
    return $root;
}

function da_test_dian($body) {
    return "# 典\n\n## 第二部分：基准框架\n\n" . trim($body) . "\n";
}

function da_test_php($module, $frameworks = array(), $extraLines = array()) {
    $lines = array('<?php', '/**', ' * @module ' . $module . ' Module');
    foreach ($frameworks as $framework) {
        $lines[] = ' * @framework ' . $framework . ' Framework';
    }
    $lines[] = ' */';
    foreach ($extraLines as $line) {
        $lines[] = $line;
    }
    return implode("\n", $lines) . "\n";
}

function da_test_vue($module, $frameworks = array()) {
    $lines = array('<!-- @module ' . $module . ' Module -->');
    foreach ($frameworks as $framework) {
        $lines[] = '<!-- @framework ' . $framework . ' Framework -->';
    }
    $lines[] = '<template><div /></template>';
    return implode("\n", $lines) . "\n";
}

function da_test_remove_tree($path) {
    if (!is_dir($path)) {
        return;
    }
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isDir()) {
            rmdir($item->getPathname());
        } else {
            unlink($item->getPathname());
        }
    }
    rmdir($path);
}

$suiteRoot = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpdts-anchor-tests-' . bin2hex(random_bytes(6));
if (!mkdir($suiteRoot, 0777, true) && !is_dir($suiteRoot)) {
    fwrite(STDERR, "Unable to create test root\n");
    exit(2);
}

$tests = array();

$tests['valid single framework'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'valid-single', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array('oblivions/api/core.php' => da_test_php('A', array('A-1'))));
    $report = design_anchor_validate($root);
    da_test_assert($report['passed'], design_anchor_render_text($report));
};

$tests['one file implements two frameworks'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'two-frameworks', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
#### 框架 A-2：投影
**代码锚点：** `oblivions/api/core.php`（核心实现）
MD), array('oblivions/api/core.php' => da_test_php('A', array('A-1', 'A-2'))));
    $report = design_anchor_validate($root);
    da_test_assert($report['passed'], design_anchor_render_text($report));
};

$tests['module-only source file is valid'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'module-only', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array(
        'oblivions/api/core.php' => da_test_php('A', array('A-1')),
        'oblivions/api/helper.php' => da_test_php('A'),
    ));
    da_test_assert(design_anchor_validate($root)['passed'], 'module-only source should pass');
};

$tests['document file missing code tag'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'document-only', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array('oblivions/api/core.php' => da_test_php('A')));
    da_test_assert_has_code(design_anchor_validate($root), 'REL003');
};

$tests['tagged code missing document anchor'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'code-only', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array(
        'oblivions/api/core.php' => da_test_php('A', array('A-1')),
        'oblivions/api/extra.php' => da_test_php('A', array('A-1')),
    ));
    da_test_assert_has_code(design_anchor_validate($root), 'REL004');
};

$tests['missing anchor path'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'missing-path', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/missing.php`（入口）
MD));
    da_test_assert_has_code(design_anchor_validate($root), 'DIA009');
};

$tests['path case mismatch'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'case-mismatch', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array('oblivions/api/Core.php' => da_test_php('A', array('A-1'))));
    da_test_assert_has_code(design_anchor_validate($root), 'DIA009');
};

$tests['unknown framework tag'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'unknown-framework', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array(
        'oblivions/api/core.php' => da_test_php('A', array('A-1')),
        'oblivions/api/unknown.php' => da_test_php('A', array('A-99')),
    ));
    da_test_assert_has_code(design_anchor_validate($root), 'REL001');
};

$tests['framework prefix differs from containing module'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'prefix-mismatch', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 B-1：错误归属
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array('oblivions/api/core.php' => da_test_php('B', array('B-1'))));
    da_test_assert_has_code(design_anchor_validate($root), 'DIA003');
};

$tests['code module differs from framework module'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'module-mismatch', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/a.php`（入口）
### 模块 B：命令层
#### 框架 B-1：命令
**代码锚点：** `oblivions/api/b.php`（核心实现）
MD), array(
        'oblivions/api/a.php' => da_test_php('B', array('A-1')),
        'oblivions/api/b.php' => da_test_php('B', array('B-1')),
    ));
    da_test_assert_has_code(design_anchor_validate($root), 'REL002');
};

$tests['multiple module tags'] = function () use ($suiteRoot) {
    $content = "<?php\n/**\n * @module A API\n * @module B Command\n * @framework A-1 Entry\n */\n";
    $root = da_test_fixture($suiteRoot, 'multiple-modules', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
### 模块 B：命令层
#### 框架 B-1：命令
**代码锚点：** `oblivions/api/b.php`（核心实现）
MD), array(
        'oblivions/api/core.php' => $content,
        'oblivions/api/b.php' => da_test_php('B', array('B-1')),
    ));
    da_test_assert_has_code(design_anchor_validate($root), 'TAG002');
};

$tests['combined framework tag is invalid'] = function () use ($suiteRoot) {
    $content = "<?php\n/**\n * @module A API\n * @framework A-1 Entry / A-2 Projection\n */\n";
    $root = da_test_fixture($suiteRoot, 'combined-framework', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
#### 框架 A-2：投影
**代码锚点：** `oblivions/api/core.php`（核心实现）
MD), array('oblivions/api/core.php' => $content));
    da_test_assert_has_code(design_anchor_validate($root), 'TAG005');
};

$tests['framework display name may contain slash'] = function () use ($suiteRoot) {
    $content = "<?php\n/**\n * @module A API\n * @framework A-1 Preview/Simulation\n */\n";
    $root = da_test_fixture($suiteRoot, 'framework-name-slash', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：预览/预演
**代码锚点：** `oblivions/api/core.php`（核心实现）
MD), array('oblivions/api/core.php' => $content));
    da_test_assert(design_anchor_validate($root)['passed'], 'slash in display name must be allowed');
};

$tests['tag-like strings are ignored'] = function () use ($suiteRoot) {
    $content = da_test_php('A', array('A-1'), array(
        '$example = "@framework A-2 is documentation text";',
    ));
    $root = da_test_fixture($suiteRoot, 'tag-string', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array('oblivions/api/core.php' => $content));
    $report = design_anchor_validate($root);
    da_test_assert($report['passed'], design_anchor_render_text($report));
};

$tests['late header tag is invalid'] = function () use ($suiteRoot) {
    $lines = array('<?php');
    for ($index = 0; $index < 40; $index++) {
        $lines[] = '// filler';
    }
    $lines[] = '// @module A API';
    $lines[] = '// @framework A-1 Entry';
    $root = da_test_fixture($suiteRoot, 'late-tag', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array('oblivions/api/core.php' => implode("\n", $lines) . "\n"));
    da_test_assert_has_code(design_anchor_validate($root), 'TAG007');
};

$tests['markdown fenced headings are ignored'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'fenced-markdown', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
```markdown
### 模块 B：伪模块
#### 框架 B-1：伪框架
**代码锚点：** `oblivions/api/fake.php`（伪锚点）
```
MD), array('oblivions/api/core.php' => da_test_php('A', array('A-1'))));
    $report = design_anchor_validate($root);
    da_test_assert($report['passed'], design_anchor_render_text($report));
    da_test_assert_same(1, $report['summary']['frameworks'], 'fenced framework must be ignored');
};

$tests['vue html comment tags'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'vue-tags', da_test_dian(<<<'MD'
### 模块 L：Vue 组件
#### 框架 L-1：列表
**代码锚点：** `vex-vue/src/List.vue`（核心实现）
MD), array('vex-vue/src/List.vue' => da_test_vue('L', array('L-1'))));
    da_test_assert(design_anchor_validate($root)['passed'], 'Vue tags should pass');
};

$tests['strict mode requires module on every source'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'strict-coverage', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array(
        'oblivions/api/core.php' => da_test_php('A', array('A-1')),
        'oblivions/api/unowned.php' => "<?php\n",
    ));
    da_test_assert_has_code(design_anchor_validate($root), 'TAG001');
};

$tests['module mode ignores unowned files outside declared relation'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'scoped-coverage', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
### 模块 B：命令层
#### 框架 B-1：待迁移框架
MD), array(
        'oblivions/api/core.php' => da_test_php('A', array('A-1')),
        'vex-vue/src/unowned.ts' => "export const value = 1\n",
    ));
    $report = design_anchor_validate($root, array('module' => 'A'));
    da_test_assert($report['passed'], design_anchor_render_text($report));
    da_test_assert($report['scoped'], 'module mode must be marked scoped');
};

$tests['text output is stable and sorted'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'stable-output', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/missing.php`（入口）
MD), array('oblivions/api/unowned.php' => "<?php\n"));
    $report = design_anchor_validate($root);
    $first = design_anchor_render_text($report);
    $second = design_anchor_render_text($report);
    da_test_assert_same($first, $second, 'text output must be deterministic');
    da_test_assert(strpos($first, '[ERROR][DIA009]') < strpos($first, '[ERROR][TAG001]'), 'errors must be sorted by code');
};

$tests['json output is parseable'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'json-output', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array('oblivions/api/core.php' => da_test_php('A', array('A-1'))));
    $json = design_anchor_render_json(design_anchor_validate($root));
    $decoded = json_decode($json, true);
    da_test_assert(is_array($decoded), 'JSON output must decode');
    da_test_assert_same(true, $decoded['passed'], 'JSON output must preserve pass state');
};

$tests['contract violation returns exit code one'] = function () use ($suiteRoot) {
    $root = da_test_fixture($suiteRoot, 'exit-one', da_test_dian(<<<'MD'
### 模块 A：API 层
#### 框架 A-1：入口
**代码锚点：** `oblivions/api/core.php`（入口）
MD), array('oblivions/api/core.php' => da_test_php('A')));
    da_test_assert_same(1, design_anchor_validate($root)['exitCode'], 'contract violation exit code');
};

$tests['invalid arguments return exit code two'] = function () {
    ob_start();
    $exitCode = design_anchor_main(array('validator.php', '--module=Z'));
    ob_end_clean();
    da_test_assert_same(2, $exitCode, 'invalid CLI arguments must return 2');
};

$tests['invalid repository shape returns system failure'] = function () use ($suiteRoot) {
    $root = $suiteRoot . DIRECTORY_SEPARATOR . 'invalid-root';
    mkdir($root, 0777, true);
    $report = design_anchor_validate($root);
    da_test_assert_has_code($report, 'SYS001');
    da_test_assert_same(2, $report['exitCode'], 'system failure exit code');
};

$passed = 0;
$failed = 0;

try {
    foreach ($tests as $name => $test) {
        try {
            $test();
            $passed++;
            echo '[PASS] ' . $name . PHP_EOL;
        } catch (Throwable $error) {
            $failed++;
            echo '[FAIL] ' . $name . PHP_EOL;
            echo '  ' . $error->getMessage() . PHP_EOL;
        }
    }
} finally {
    da_test_remove_tree($suiteRoot);
}

echo PHP_EOL . sprintf('Tests: %d passed, %d failed', $passed, $failed) . PHP_EOL;
exit($failed === 0 ? 0 : 1);
