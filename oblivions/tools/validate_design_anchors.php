<?php

const DESIGN_ANCHOR_HEADER_LINE_LIMIT = 40;

function design_anchor_normalize_path($path) {
    return str_replace('\\', '/', (string)$path);
}

function design_anchor_starts_with($value, $prefix) {
    return substr($value, 0, strlen($prefix)) === $prefix;
}

function design_anchor_issue($code, $message, $context = array()) {
    return array_merge(array(
        'severity' => 'error',
        'code' => $code,
        'message' => $message,
        'module' => null,
        'framework' => null,
        'file' => null,
        'line' => null,
    ), $context);
}

function design_anchor_locate_root($startDirectory) {
    $directory = realpath($startDirectory);
    while ($directory !== false) {
        if (
            is_file($directory . DIRECTORY_SEPARATOR . 'oblivions' . DIRECTORY_SEPARATOR . 'DESIGN.md') &&
            is_file($directory . DIRECTORY_SEPARATOR . 'oblivions' . DIRECTORY_SEPARATOR . 'Dian.md') &&
            is_dir($directory . DIRECTORY_SEPARATOR . 'vex-vue')
        ) {
            return design_anchor_normalize_path($directory);
        }

        $parent = dirname($directory);
        if ($parent === $directory) {
            break;
        }
        $directory = $parent;
    }
    return false;
}

function design_anchor_parse_cli($argv) {
    $options = array(
        'module' => null,
        'format' => 'text',
        'help' => false,
    );

    for ($index = 1; $index < count($argv); $index++) {
        $argument = (string)$argv[$index];

        if ($argument === '--help' || $argument === '-h') {
            $options['help'] = true;
            continue;
        }

        if (design_anchor_starts_with($argument, '--module=')) {
            $options['module'] = substr($argument, strlen('--module='));
            continue;
        }
        if ($argument === '--module') {
            if (!isset($argv[$index + 1])) {
                return array('options' => $options, 'issue' => design_anchor_issue('SYS003', '--module requires a value'));
            }
            $options['module'] = (string)$argv[++$index];
            continue;
        }

        if (design_anchor_starts_with($argument, '--format=')) {
            $options['format'] = substr($argument, strlen('--format='));
            continue;
        }
        if ($argument === '--format') {
            if (!isset($argv[$index + 1])) {
                return array('options' => $options, 'issue' => design_anchor_issue('SYS003', '--format requires a value'));
            }
            $options['format'] = (string)$argv[++$index];
            continue;
        }

        return array(
            'options' => $options,
            'issue' => design_anchor_issue('SYS003', 'unknown argument: ' . $argument),
        );
    }

    if ($options['module'] !== null && !preg_match('/^[A-Z]$/', $options['module'])) {
        return array(
            'options' => $options,
            'issue' => design_anchor_issue('SYS003', 'module must be one uppercase letter from A to Z'),
        );
    }
    if (!in_array($options['format'], array('text', 'json'), true)) {
        return array(
            'options' => $options,
            'issue' => design_anchor_issue('SYS003', 'format must be text or json'),
        );
    }

    return array('options' => $options, 'issue' => null);
}

function design_anchor_usage() {
    return implode(PHP_EOL, array(
        'Usage: php oblivions/tools/validate_design_anchors.php [options]',
        '',
        'Options:',
        '  --module=A          Validate one module during migration',
        '  --format=text|json  Select output format (default: text)',
        '  --help              Show this help',
    )) . PHP_EOL;
}

class DesignAnchorValidator {
    private $root;
    private $moduleFilter;
    private $issues = array();
    private $modules = array();
    private $frameworks = array();
    private $sourceFiles = array();
    private $sourceFilesLowercase = array();
    private $fileTags = array();
    private $taggedFilesByFramework = array();

    public function __construct($root, $options = array()) {
        $resolvedRoot = realpath($root);
        $this->root = $resolvedRoot === false
            ? design_anchor_normalize_path($root)
            : design_anchor_normalize_path($resolvedRoot);
        $this->moduleFilter = isset($options['module']) ? $options['module'] : null;
    }

    public function validate() {
        if (!$this->hasRepositoryShape()) {
            $this->issues[] = design_anchor_issue(
                'SYS001',
                'repository root must contain oblivions/DESIGN.md, oblivions/Dian.md, and vex-vue/'
            );
            return $this->buildReport();
        }

        $this->parseDian();
        if ($this->hasSystemIssue()) {
            return $this->buildReport();
        }

        $this->scanSourceFiles();
        if ($this->hasSystemIssue()) {
            return $this->buildReport();
        }

        $this->parseSourceTags();
        $this->validateDianStructure();
        $this->validateTagStructure();
        $this->validateRelationships();

        return $this->buildReport();
    }

    private function hasRepositoryShape() {
        return is_file($this->absolutePath('oblivions/DESIGN.md'))
            && is_file($this->absolutePath('oblivions/Dian.md'))
            && is_dir($this->absolutePath('vex-vue'));
    }

    private function absolutePath($relativePath) {
        return str_replace('/', DIRECTORY_SEPARATOR, $this->root . '/' . ltrim($relativePath, '/'));
    }

    private function addIssue($code, $message, $context = array()) {
        $this->issues[] = design_anchor_issue($code, $message, $context);
    }

    private function hasSystemIssue() {
        foreach ($this->issues as $issue) {
            if (design_anchor_starts_with($issue['code'], 'SYS')) {
                return true;
            }
        }
        return false;
    }

    private function shouldValidateModule($moduleId) {
        return $this->moduleFilter === null || $moduleId === null || $moduleId === $this->moduleFilter;
    }

    private function shouldValidateFramework($framework) {
        return $this->moduleFilter === null || $framework['module'] === $this->moduleFilter;
    }

    private function parseDian() {
        $path = $this->absolutePath('oblivions/Dian.md');
        $lines = @file($path, FILE_IGNORE_NEW_LINES);
        if ($lines === false) {
            $this->addIssue('SYS002', 'unable to read oblivions/Dian.md', array('file' => 'oblivions/Dian.md'));
            return;
        }

        $currentModule = null;
        $currentFramework = null;
        $fenceCharacter = null;
        $fenceLength = 0;

        foreach ($lines as $offset => $line) {
            $lineNumber = $offset + 1;

            if (preg_match('/^\s*(`{3,}|~{3,})/', $line, $fenceMatch)) {
                $marker = $fenceMatch[1];
                $character = $marker[0];
                $length = strlen($marker);
                if ($fenceCharacter === null) {
                    $fenceCharacter = $character;
                    $fenceLength = $length;
                } elseif ($character === $fenceCharacter && $length >= $fenceLength) {
                    $fenceCharacter = null;
                    $fenceLength = 0;
                }
                continue;
            }
            if ($fenceCharacter !== null) {
                continue;
            }

            if (design_anchor_starts_with($line, '### 模块 ')) {
                if (!preg_match('/^### 模块 ([A-Z])：(.+?)\s*$/u', $line, $matches)) {
                    $this->addIssue('DIA001', 'invalid module heading', array(
                        'file' => 'oblivions/Dian.md',
                        'line' => $lineNumber,
                    ));
                    $currentModule = null;
                    $currentFramework = null;
                    continue;
                }

                $moduleId = $matches[1];
                if (isset($this->modules[$moduleId])) {
                    if ($this->shouldValidateModule($moduleId)) {
                        $this->addIssue('DIA001', 'duplicate module heading: ' . $moduleId, array(
                            'module' => $moduleId,
                            'file' => 'oblivions/Dian.md',
                            'line' => $lineNumber,
                        ));
                    }
                } else {
                    $this->modules[$moduleId] = array(
                        'id' => $moduleId,
                        'name' => trim($matches[2]),
                        'line' => $lineNumber,
                    );
                }
                $currentModule = $moduleId;
                $currentFramework = null;
                continue;
            }

            if (design_anchor_starts_with($line, '#### 框架 ')) {
                if (!preg_match('/^#### 框架 ([A-Z]-[0-9]+)：(.+?)\s*$/u', $line, $matches)) {
                    $this->addIssue('DIA002', 'invalid framework heading', array(
                        'module' => $currentModule,
                        'file' => 'oblivions/Dian.md',
                        'line' => $lineNumber,
                    ));
                    $currentFramework = null;
                    continue;
                }

                $frameworkId = $matches[1];
                $frameworkModule = substr($frameworkId, 0, 1);
                if ($currentModule === null || $currentModule !== $frameworkModule) {
                    if ($this->shouldValidateModule($currentModule !== null ? $currentModule : $frameworkModule)) {
                        $this->addIssue('DIA003', 'framework prefix does not match containing module: ' . $frameworkId, array(
                            'module' => $currentModule,
                            'framework' => $frameworkId,
                            'file' => 'oblivions/Dian.md',
                            'line' => $lineNumber,
                        ));
                    }
                }

                if (isset($this->frameworks[$frameworkId])) {
                    if ($this->shouldValidateModule($frameworkModule)) {
                        $this->addIssue('DIA002', 'duplicate framework heading: ' . $frameworkId, array(
                            'module' => $frameworkModule,
                            'framework' => $frameworkId,
                            'file' => 'oblivions/Dian.md',
                            'line' => $lineNumber,
                        ));
                    }
                } else {
                    $this->frameworks[$frameworkId] = array(
                        'id' => $frameworkId,
                        'module' => $frameworkModule,
                        'name' => trim($matches[2]),
                        'line' => $lineNumber,
                        'anchorLineCount' => 0,
                        'anchorLines' => array(),
                        'anchorFiles' => array(),
                    );
                }
                $currentFramework = $frameworkId;
                continue;
            }

            if (design_anchor_starts_with($line, '**代码锚点：**')) {
                if ($currentFramework === null || !isset($this->frameworks[$currentFramework])) {
                    if ($this->shouldValidateModule($currentModule)) {
                        $this->addIssue('DIA005', 'code anchor line is outside a framework section', array(
                            'module' => $currentModule,
                            'file' => 'oblivions/Dian.md',
                            'line' => $lineNumber,
                        ));
                    }
                    continue;
                }

                $this->frameworks[$currentFramework]['anchorLineCount']++;
                $this->frameworks[$currentFramework]['anchorLines'][] = $lineNumber;
                preg_match_all('/`([^`]+)`/u', $line, $pathMatches);
                foreach ($pathMatches[1] as $anchorPath) {
                    $this->frameworks[$currentFramework]['anchorFiles'][] = array(
                        'path' => trim($anchorPath),
                        'line' => $lineNumber,
                    );
                }
            }
        }
    }

    private function scanSourceFiles() {
        $roots = array(
            array('path' => 'oblivions', 'extensions' => array('php')),
            array('path' => 'oblivions/editor/src', 'extensions' => array('js')),
            array('path' => 'oblivions/shared/src', 'extensions' => array('ts', 'vue')),
            array('path' => 'oblivions/editor-next/src', 'extensions' => array('ts', 'vue')),
            array('path' => 'vex-vue/src', 'extensions' => array('ts', 'vue')),
        );

        foreach ($roots as $scanRoot) {
            $absoluteRoot = $this->absolutePath($scanRoot['path']);
            if (!is_dir($absoluteRoot)) {
                $this->addIssue('SYS004', 'source root does not exist: ' . $scanRoot['path'], array('file' => $scanRoot['path']));
                continue;
            }

            try {
                $iterator = new RecursiveIteratorIterator(
                    new RecursiveDirectoryIterator($absoluteRoot, FilesystemIterator::SKIP_DOTS)
                );
                foreach ($iterator as $fileInfo) {
                    if (!$fileInfo->isFile()) {
                        continue;
                    }
                    $absolutePath = design_anchor_normalize_path($fileInfo->getPathname());
                    $relativePath = substr($absolutePath, strlen($this->root) + 1);
                    if ($this->isExcludedPath($relativePath)) {
                        continue;
                    }
                    $extension = strtolower(pathinfo($relativePath, PATHINFO_EXTENSION));
                    if (!in_array($extension, $scanRoot['extensions'], true)) {
                        continue;
                    }
                    $this->sourceFiles[$relativePath] = array(
                        'path' => $relativePath,
                        'absolutePath' => $absolutePath,
                    );
                    $lower = strtolower($relativePath);
                    if (!isset($this->sourceFilesLowercase[$lower])) {
                        $this->sourceFilesLowercase[$lower] = $relativePath;
                    }
                }
            } catch (Throwable $error) {
                $this->addIssue('SYS004', 'unable to scan source root: ' . $scanRoot['path'] . ' (' . $error->getMessage() . ')', array(
                    'file' => $scanRoot['path'],
                ));
            }
        }

        ksort($this->sourceFiles, SORT_STRING);
    }

    private function isExcludedPath($relativePath) {
        $normalized = design_anchor_normalize_path($relativePath);
        $excludedPrefixes = array(
            'oblivions/tests/',
            'oblivions/tools/',
            'oblivions/docs/',
            'oblivions/cache/',
            'oblivions/shared/node_modules/',
            'oblivions/shared/dist/',
            'oblivions/editor-next/node_modules/',
            'oblivions/editor-next/dist/',
            'oblivions/editor-next/tests/',
            'oblivions/editor-next/.storybook/',
            'vex-vue/node_modules/',
            'vex-vue/dist/',
        );
        foreach ($excludedPrefixes as $prefix) {
            if (design_anchor_starts_with($normalized, $prefix)) {
                return true;
            }
        }
        $excludedFiles = array(
            // Vite 自动生成的环境声明文件，不属于业务模块
            'oblivions/editor-next/src/vite-env.d.ts',
            'oblivions/shared/src/vite-env.d.ts',
        );
        foreach ($excludedFiles as $file) {
            if ($normalized === $file) {
                return true;
            }
        }
        return false;
    }

    private function parseSourceTags() {
        foreach ($this->sourceFiles as $relativePath => $sourceFile) {
            $lines = @file($sourceFile['absolutePath'], FILE_IGNORE_NEW_LINES);
            if ($lines === false) {
                $this->addIssue('SYS004', 'unable to read source file', array('file' => $relativePath));
                continue;
            }

            $tags = array(
                'moduleEntries' => array(),
                'frameworkEntries' => array(),
                'invalidModuleEntries' => array(),
                'invalidFrameworkEntries' => array(),
            );

            foreach ($lines as $offset => $line) {
                $lineNumber = $offset + 1;
                if (strpos($line, '@module') !== false) {
                    $this->parseModuleTagLine($relativePath, $line, $lineNumber, $tags);
                }
                if (strpos($line, '@framework') !== false) {
                    $this->parseFrameworkTagLine($relativePath, $line, $lineNumber, $tags);
                }
            }

            $this->fileTags[$relativePath] = $tags;
            foreach ($tags['frameworkEntries'] as $entry) {
                $frameworkId = $entry['id'];
                if (!isset($this->taggedFilesByFramework[$frameworkId])) {
                    $this->taggedFilesByFramework[$frameworkId] = array();
                }
                $this->taggedFilesByFramework[$frameworkId][$relativePath] = $entry['line'];
            }
        }
    }

    private function cleanTagPayload($payload) {
        return trim(preg_replace('/\s*(?:\*\/|-->)\s*$/u', '', (string)$payload));
    }

    private function parseModuleTagLine($relativePath, $line, $lineNumber, &$tags) {
        if (!preg_match('/^\s*(?:\*|\/\/|<!--)\s*@module\b(.*?)\s*$/u', $line, $matches)) {
            return;
        }
        $payload = $this->cleanTagPayload($matches[1]);
        if ($lineNumber > DESIGN_ANCHOR_HEADER_LINE_LIMIT) {
            $this->addIssue('TAG007', '@module tag is outside the first ' . DESIGN_ANCHOR_HEADER_LINE_LIMIT . ' lines', array(
                'file' => $relativePath,
                'line' => $lineNumber,
            ));
            return;
        }
        if (!preg_match('/^([A-Z])(?:\s+.+)?$/u', $payload, $payloadMatches)) {
            $tags['invalidModuleEntries'][] = array('payload' => $payload, 'line' => $lineNumber);
            $this->addIssue('TAG003', 'invalid @module tag: ' . $payload, array(
                'file' => $relativePath,
                'line' => $lineNumber,
            ));
            return;
        }
        $tags['moduleEntries'][] = array('id' => $payloadMatches[1], 'line' => $lineNumber);
    }

    private function parseFrameworkTagLine($relativePath, $line, $lineNumber, &$tags) {
        if (!preg_match('/^\s*(?:\*|\/\/|<!--)\s*@framework\b(.*?)\s*$/u', $line, $matches)) {
            return;
        }
        $payload = $this->cleanTagPayload($matches[1]);
        if ($lineNumber > DESIGN_ANCHOR_HEADER_LINE_LIMIT) {
            $this->addIssue('TAG007', '@framework tag is outside the first ' . DESIGN_ANCHOR_HEADER_LINE_LIMIT . ' lines', array(
                'file' => $relativePath,
                'line' => $lineNumber,
            ));
            return;
        }

        preg_match_all('/[A-Z]-[0-9]+/', $payload, $idMatches);
        if (count($idMatches[0]) !== 1) {
            $tags['invalidFrameworkEntries'][] = array('payload' => $payload, 'line' => $lineNumber);
            $this->addIssue('TAG005', '@framework must contain exactly one framework id: ' . $payload, array(
                'file' => $relativePath,
                'line' => $lineNumber,
            ));
            return;
        }
        if (!preg_match('/^([A-Z]-[0-9]+)(?:\s+.+)?$/u', $payload, $payloadMatches)) {
            $tags['invalidFrameworkEntries'][] = array('payload' => $payload, 'line' => $lineNumber);
            $this->addIssue('TAG006', 'invalid @framework tag: ' . $payload, array(
                'file' => $relativePath,
                'line' => $lineNumber,
            ));
            return;
        }
        $tags['frameworkEntries'][] = array('id' => $payloadMatches[1], 'line' => $lineNumber);
    }

    private function validateDianStructure() {
        foreach ($this->frameworks as $frameworkId => &$framework) {
            if (!$this->shouldValidateFramework($framework)) {
                continue;
            }
            $context = array(
                'module' => $framework['module'],
                'framework' => $frameworkId,
                'file' => 'oblivions/Dian.md',
                'line' => $framework['line'],
            );

            if ($framework['anchorLineCount'] === 0) {
                $this->addIssue('DIA004', 'framework is missing a code anchor line', $context);
            } elseif ($framework['anchorLineCount'] > 1) {
                $context['line'] = $framework['anchorLines'][1];
                $this->addIssue('DIA005', 'framework has multiple code anchor lines', $context);
            }
            if ($framework['anchorLineCount'] > 0 && count($framework['anchorFiles']) === 0) {
                $context['line'] = $framework['anchorLines'][0];
                $this->addIssue('DIA006', 'code anchor line contains no file paths', $context);
            }

            $seen = array();
            foreach ($framework['anchorFiles'] as $anchorEntry) {
                $path = $anchorEntry['path'];
                $pathContext = array_merge($context, array('file' => $path, 'line' => $anchorEntry['line']));
                if (isset($seen[$path])) {
                    $this->addIssue('DIA007', 'framework lists the same anchor file more than once', $pathContext);
                }
                $seen[$path] = true;

                if (!$this->isValidRelativePath($path)) {
                    $this->addIssue('DIA008', 'anchor path is not a normalized repository-relative path', $pathContext);
                    continue;
                }
                if (!$this->isSupportedAnchorExtension($path)) {
                    $this->addIssue('DIA010', 'anchor file type is not supported', $pathContext);
                    continue;
                }
                if (!isset($this->sourceFiles[$path])) {
                    $lower = strtolower($path);
                    $message = isset($this->sourceFilesLowercase[$lower])
                        ? 'anchor path case does not match repository path; expected ' . $this->sourceFilesLowercase[$lower]
                        : 'anchor path does not point to a supported production source file';
                    $this->addIssue('DIA009', $message, $pathContext);
                }
            }

            $framework['anchorFileSet'] = array();
            foreach ($framework['anchorFiles'] as $anchorEntry) {
                $framework['anchorFileSet'][$anchorEntry['path']] = true;
            }
            ksort($framework['anchorFileSet'], SORT_STRING);
        }
        unset($framework);
    }

    private function isValidRelativePath($path) {
        if ($path === '' || strpos($path, '\\') !== false || strpos($path, "\0") !== false) {
            return false;
        }
        if ($path[0] === '/' || design_anchor_starts_with($path, './') || design_anchor_starts_with($path, '../')) {
            return false;
        }
        if (preg_match('/^[A-Za-z]:/', $path)) {
            return false;
        }
        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return false;
            }
        }
        return true;
    }

    private function isSupportedAnchorExtension($path) {
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (design_anchor_starts_with($path, 'oblivions/editor/')) {
            return in_array($extension, array('js', 'ts'), true) && !$this->isExcludedPath($path);
        }
        if (design_anchor_starts_with($path, 'oblivions/editor-next/src/')) {
            return in_array($extension, array('ts', 'vue'), true) && !$this->isExcludedPath($path);
        }
        if (design_anchor_starts_with($path, 'oblivions/shared/src/')) {
            return in_array($extension, array('ts'), true) && !$this->isExcludedPath($path);
        }
        if (design_anchor_starts_with($path, 'oblivions/')) {
            return $extension === 'php' && !$this->isExcludedPath($path);
        }
        if (design_anchor_starts_with($path, 'vex-vue/src/')) {
            return in_array($extension, array('ts', 'vue'), true) && !$this->isExcludedPath($path);
        }
        return false;
    }

    private function validateTagStructure() {
        foreach ($this->fileTags as $relativePath => $tags) {
            $moduleEntries = $tags['moduleEntries'];
            $frameworkEntries = $tags['frameworkEntries'];

            if ($this->moduleFilter === null && count($moduleEntries) === 0) {
                $this->addIssue('TAG001', 'production source file is missing @module', array('file' => $relativePath));
            }
            if (count($moduleEntries) > 1) {
                $this->addIssue('TAG002', 'source file declares multiple @module tags', array(
                    'file' => $relativePath,
                    'line' => $moduleEntries[1]['line'],
                ));
            }

            foreach ($moduleEntries as $entry) {
                if (!isset($this->modules[$entry['id']])) {
                    $this->addIssue('TAG003', '@module does not exist in Dian.md: ' . $entry['id'], array(
                        'module' => $entry['id'],
                        'file' => $relativePath,
                        'line' => $entry['line'],
                    ));
                }
            }

            $seenFrameworks = array();
            foreach ($frameworkEntries as $entry) {
                if (isset($seenFrameworks[$entry['id']])) {
                    $this->addIssue('TAG004', 'source file repeats @framework ' . $entry['id'], array(
                        'framework' => $entry['id'],
                        'file' => $relativePath,
                        'line' => $entry['line'],
                    ));
                }
                $seenFrameworks[$entry['id']] = true;
            }

            if (count($frameworkEntries) > 0 && count($moduleEntries) !== 1) {
                $this->addIssue('TAG008', 'a file with @framework must declare exactly one valid @module', array(
                    'file' => $relativePath,
                    'line' => $frameworkEntries[0]['line'],
                ));
            }
        }
    }

    private function validateRelationships() {
        foreach ($this->fileTags as $relativePath => $tags) {
            $moduleId = count($tags['moduleEntries']) === 1 ? $tags['moduleEntries'][0]['id'] : null;
            // 跨模块桥接支持：一个文件可同时实现多个模块的框架（如归属 K 模块的
            // BattleModal 同时实现 K-1 与 L-4）。此时其主 @module 只需被至少一个
            // 框架覆盖；其余不同模块的框架视为合理的跨模块实现，不触发 REL002。
            // 仅当文件的 @module 不匹配其任何一个框架所属模块时（疑似标签笔误）才报错。
            $frameworkModuleSet = array();
            foreach ($tags['frameworkEntries'] as $entry) {
                $frameworkId = $entry['id'];
                if (isset($this->frameworks[$frameworkId])) {
                    $frameworkModuleSet[$this->frameworks[$frameworkId]['module']] = true;
                }
            }
            $primaryModuleCovered = $moduleId !== null && isset($frameworkModuleSet[$moduleId]);
            foreach ($tags['frameworkEntries'] as $entry) {
                $frameworkId = $entry['id'];
                if (!isset($this->frameworks[$frameworkId])) {
                    $this->addIssue('REL001', '@framework does not exist in Dian.md: ' . $frameworkId, array(
                        'module' => $moduleId,
                        'framework' => $frameworkId,
                        'file' => $relativePath,
                        'line' => $entry['line'],
                    ));
                    continue;
                }
                $expectedModule = $this->frameworks[$frameworkId]['module'];
                if ($moduleId !== null && $moduleId !== $expectedModule && !$primaryModuleCovered) {
                    $this->addIssue('REL002', '@module does not match framework module', array(
                        'module' => $moduleId,
                        'framework' => $frameworkId,
                        'file' => $relativePath,
                        'line' => $entry['line'],
                    ));
                }
            }
        }

        foreach ($this->frameworks as $frameworkId => $framework) {
            if (!$this->shouldValidateFramework($framework)) {
                continue;
            }
            $documentSet = isset($framework['anchorFileSet']) ? $framework['anchorFileSet'] : array();
            $codeSet = isset($this->taggedFilesByFramework[$frameworkId])
                ? $this->taggedFilesByFramework[$frameworkId]
                : array();

            $documentOnly = array_diff_key($documentSet, $codeSet);
            $codeOnly = array_diff_key($codeSet, $documentSet);

            foreach (array_keys($documentOnly) as $path) {
                $this->addIssue('REL003', 'Dian anchor file does not declare the framework', array(
                    'module' => $framework['module'],
                    'framework' => $frameworkId,
                    'file' => $path,
                    'line' => $framework['line'],
                ));
            }
            foreach (array_keys($codeOnly) as $path) {
                $this->addIssue('REL004', 'tagged code file is absent from the Dian anchor set', array(
                    'module' => $framework['module'],
                    'framework' => $frameworkId,
                    'file' => $path,
                    'line' => $codeSet[$path],
                ));
            }
            if (count($documentOnly) > 0 || count($codeOnly) > 0) {
                $this->addIssue('REL005', 'Dian anchor files and code tag files are not equal', array(
                    'module' => $framework['module'],
                    'framework' => $frameworkId,
                    'file' => 'oblivions/Dian.md',
                    'line' => $framework['line'],
                    'documentOnly' => array_values(array_keys($documentOnly)),
                    'codeOnly' => array_values(array_keys($codeOnly)),
                ));
            }
        }
    }

    private function buildReport() {
        usort($this->issues, function ($left, $right) {
            $leftKey = implode('|', array(
                $left['code'],
                $left['framework'] !== null ? $left['framework'] : '',
                $left['file'] !== null ? $left['file'] : '',
                $left['line'] !== null ? str_pad((string)$left['line'], 8, '0', STR_PAD_LEFT) : '',
                $left['message'],
            ));
            $rightKey = implode('|', array(
                $right['code'],
                $right['framework'] !== null ? $right['framework'] : '',
                $right['file'] !== null ? $right['file'] : '',
                $right['line'] !== null ? str_pad((string)$right['line'], 8, '0', STR_PAD_LEFT) : '',
                $right['message'],
            ));
            return strcmp($leftKey, $rightKey);
        });

        $hasSystemIssue = false;
        foreach ($this->issues as $issue) {
            if (design_anchor_starts_with($issue['code'], 'SYS')) {
                $hasSystemIssue = true;
                break;
            }
        }

        $targetFrameworkCount = 0;
        foreach ($this->frameworks as $framework) {
            if ($this->shouldValidateFramework($framework)) {
                $targetFrameworkCount++;
            }
        }

        return array(
            'mode' => $this->moduleFilter === null ? 'strict' : 'module',
            'module' => $this->moduleFilter,
            'scoped' => $this->moduleFilter !== null,
            'passed' => count($this->issues) === 0,
            'exitCode' => $hasSystemIssue ? 2 : (count($this->issues) > 0 ? 1 : 0),
            'errors' => $this->issues,
            'summary' => array(
                'modules' => count($this->modules),
                'frameworks' => $targetFrameworkCount,
                'sourceFiles' => count($this->sourceFiles),
                'errors' => count($this->issues),
            ),
        );
    }
}

function design_anchor_validate($root, $options = array()) {
    $validator = new DesignAnchorValidator($root, $options);
    return $validator->validate();
}

function design_anchor_render_text($report) {
    $lines = array();
    if (!empty($report['scoped'])) {
        $lines[] = 'SCOPED VALIDATION: module ' . $report['module'];
        $lines[] = 'A scoped pass does not mean the whole project is compliant.';
        $lines[] = '';
    }

    foreach ($report['errors'] as $issue) {
        $location = '';
        if ($issue['file'] !== null) {
            $location = ' ' . $issue['file'];
            if ($issue['line'] !== null) {
                $location .= ':' . $issue['line'];
            }
        }
        $subject = '';
        if ($issue['framework'] !== null) {
            $subject = ' framework ' . $issue['framework'];
        } elseif ($issue['module'] !== null) {
            $subject = ' module ' . $issue['module'];
        }
        $lines[] = '[ERROR][' . $issue['code'] . ']' . $subject . $location;
        $lines[] = '  ' . $issue['message'];
        if (isset($issue['documentOnly']) && count($issue['documentOnly']) > 0) {
            $lines[] = '  document only: ' . implode(', ', $issue['documentOnly']);
        }
        if (isset($issue['codeOnly']) && count($issue['codeOnly']) > 0) {
            $lines[] = '  code only: ' . implode(', ', $issue['codeOnly']);
        }
        $lines[] = '';
    }

    $summary = $report['summary'];
    $lines[] = sprintf(
        'Summary: %d error%s, %d module%s, %d framework%s, %d source file%s',
        $summary['errors'],
        $summary['errors'] === 1 ? '' : 's',
        $summary['modules'],
        $summary['modules'] === 1 ? '' : 's',
        $summary['frameworks'],
        $summary['frameworks'] === 1 ? '' : 's',
        $summary['sourceFiles'],
        $summary['sourceFiles'] === 1 ? '' : 's'
    );
    $lines[] = 'Result: ' . ($report['passed'] ? 'PASSED' : 'FAILED');

    return implode(PHP_EOL, $lines) . PHP_EOL;
}

function design_anchor_render_json($report) {
    return json_encode($report, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . PHP_EOL;
}

function design_anchor_main($argv) {
    $parsed = design_anchor_parse_cli($argv);
    $options = $parsed['options'];

    if ($options['help']) {
        echo design_anchor_usage();
        return 0;
    }

    if ($parsed['issue'] !== null) {
        $report = array(
            'mode' => $options['module'] === null ? 'strict' : 'module',
            'module' => $options['module'],
            'scoped' => $options['module'] !== null,
            'passed' => false,
            'exitCode' => 2,
            'errors' => array($parsed['issue']),
            'summary' => array('modules' => 0, 'frameworks' => 0, 'sourceFiles' => 0, 'errors' => 1),
        );
        echo $options['format'] === 'json'
            ? design_anchor_render_json($report)
            : design_anchor_render_text($report);
        return 2;
    }

    $root = design_anchor_locate_root(__DIR__);
    if ($root === false) {
        $report = array(
            'mode' => $options['module'] === null ? 'strict' : 'module',
            'module' => $options['module'],
            'scoped' => $options['module'] !== null,
            'passed' => false,
            'exitCode' => 2,
            'errors' => array(design_anchor_issue('SYS001', 'unable to locate repository root')),
            'summary' => array('modules' => 0, 'frameworks' => 0, 'sourceFiles' => 0, 'errors' => 1),
        );
    } else {
        $report = design_anchor_validate($root, $options);
    }

    echo $options['format'] === 'json'
        ? design_anchor_render_json($report)
        : design_anchor_render_text($report);
    return $report['exitCode'];
}

if (realpath(isset($_SERVER['SCRIPT_FILENAME']) ? $_SERVER['SCRIPT_FILENAME'] : '') === __FILE__) {
    exit(design_anchor_main($argv));
}
