// 对话系统的JavaScript扩展

// 扩展changePages函数，处理对话选择页面
function dialogueChangePages(mode, cPages) {
    console.log('dialogueChangePages called with mode=' + mode + ', cPages=' + cPages);

    var nowpage = Number(document.getElementById(mode + 'markpage').innerHTML);
    var endpage = Number(document.getElementById(mode + 'endpage').innerHTML);
    var maxdkey = endpage + 1; // 选择页面的ID

    console.log('Current page: ' + nowpage + ', End page: ' + endpage + ', Choice page ID: ' + maxdkey);

    if(nowpage < 0 || nowpage > endpage) {
        nowpage = 0;
        console.log('Reset nowpage to 0');
    }

    var nextpage = nowpage + cPages;
    console.log('Next page: ' + nextpage);
    document.getElementById(mode + 'markpage').innerHTML = nextpage;

    // 隐藏当前页面
    var currentPage = document.getElementById(mode + nowpage);
    if(currentPage) {
        currentPage.style.display = "none";
        console.log('Hiding current page: ' + mode + nowpage);
    } else {
        console.error('Current page not found: ' + mode + nowpage);
    }

    // 如果下一页是选择页面
    if(nextpage > endpage) {
        console.log('Next page is choice page');
        // 显示选择页面
        var choicePage = document.getElementById(mode + maxdkey);
        console.log('Looking for choice page with ID: ' + mode + maxdkey);

        // 列出所有可用的元素ID
        console.log('Available elements:');
        var allElements = document.getElementsByTagName('*');
        for(var i=0; i<allElements.length; i++) {
            if(allElements[i].id && allElements[i].id.startsWith(mode)) {
                console.log('- ' + allElements[i].id);
            }
        }

        if(choicePage) {
            choicePage.style.display = "block";
            console.log("Showing choice page: " + mode + maxdkey);
        } else {
            console.error("Choice page not found: " + mode + maxdkey);
        }
    } else {
        console.log('Next page is dialogue page');
        // 显示普通对话页面
        var dialoguePage = document.getElementById(mode + nextpage);
        if(dialoguePage) {
            dialoguePage.style.display = "block";
            console.log("Showing dialogue page: " + mode + nextpage);
        } else {
            console.error("Dialogue page not found: " + mode + nextpage);
        }
    }
}

// 覆盖原有的changePages函数
function changePages(mode, cPages) {
    // 如果是对话系统，使用dialogueChangePages
    if(mode === 'd') {
        dialogueChangePages(mode, cPages);
    } else {
        // 否则使用原有的逻辑
        var nowpage = Number(document.getElementById(mode + 'markpage').innerHTML);
        var endpage = Number(document.getElementById(mode + 'endpage').innerHTML);

        if(nowpage < 0 || nowpage > endpage) {
            nowpage = 0;
        }

        var nextpage = nowpage + cPages;
        document.getElementById(mode + 'markpage').innerHTML = nowpage + cPages;

        var currentPage = document.getElementById(mode + nowpage);
        if(currentPage) {
            currentPage.style.display = "none";
        }

        var nextPageElement = document.getElementById(mode + nextpage);
        if(nextPageElement) {
            nextPageElement.style.display = "inline-block";
        }

        var prevButton = document.getElementById('shooting_previous');
        if(prevButton) {
            prevButton.style.display = nextpage > 0 ? 'inline-block' : 'none';
        }

        var nextButton = document.getElementById('shooting_next');
        if(nextButton) {
            nextButton.style.display = (nextpage >= endpage) ? 'none' : 'inline-block';
        }

        var endingButton = document.getElementById('shooting_ending');
        if(endingButton) {
            endingButton.style.display = (nextpage == endpage) ? 'inline-block' : 'none';
        }
    }
}

// 处理对话选择
function handleDialogueChoice(dialogueId, choiceIndex) {
    // 添加非常明显的控制台日志
    console.log('%c对话选择调试信息', 'background: red; color: white; font-size: 20px;');
    console.log('%c对话 ID = ' + dialogueId + ', 选择索引 = ' + choiceIndex, 'background: red; color: white; font-size: 20px;');

    console.log('handleDialogueChoice called with dialogueId=' + dialogueId + ', choiceIndex=' + choiceIndex);

    try {
        // 禁用所有选择按钮，防止重复点击
        var choiceButtons = document.querySelectorAll('#dialogue input.cmdbutton');
        if (choiceButtons && choiceButtons.length > 0) {
            for(var i = 0; i < choiceButtons.length; i++) {
                choiceButtons[i].disabled = true;
            }
            console.log('All choice buttons disabled');
        } else {
            console.warn('No choice buttons found to disable');
        }

        // 设置命令值
        var commandInput = document.getElementById('command');
        if(commandInput) {
            commandInput.value = 'dialogue_choice ' + dialogueId + ' ' + choiceIndex;
            console.log('Command set to: ' + commandInput.value);
        } else {
            console.error('Command input not found!');
            return false;
        }

        // 关闭对话框
        var dialogueElement = document.getElementById('dialogue');
        if(dialogueElement) {
            try {
                // 在关闭对话框前添加一个“处理中”的提示
                var processingDiv = document.createElement('div');
                processingDiv.innerHTML = '<span style="color: yellow; font-weight: bold;">正在处理选择...</span>';
                processingDiv.style.textAlign = 'center';
                processingDiv.style.padding = '10px';
                dialogueElement.appendChild(processingDiv);

                // 延迟关闭对话框，给用户一个反馈
                setTimeout(function() {
                    try {
                        dialogueElement.close();
                        console.log('Dialogue closed');
                    } catch (closeError) {
                        console.error('Error closing dialogue:', closeError);
                    }

                    // 在关闭对话框后再提交命令
                    setTimeout(function() {
                        console.log('Submitting command...');
                        try {
                            postCmd('gamecmd', 'command.php');
                            console.log('Command submitted');
                        } catch (postError) {
                            console.error('Error posting command:', postError);
                            // 如果提交命令出错，尝试直接提交表单
                            try {
                                document.getElementById('gamecmd').submit();
                                console.log('Form submitted directly');
                            } catch (submitError) {
                                console.error('Error submitting form:', submitError);
                            }
                        }
                    }, 100);
                }, 500);
            } catch (processError) {
                console.error('Error processing dialogue:', processError);
                // 如果处理对话框出错，直接提交命令
                postCmd('gamecmd', 'command.php');
            }
        } else {
            console.error('Dialogue element not found!');
            // 如果没有找到对话框，也要提交命令
            setTimeout(function() {
                console.log('Submitting command anyway...');
                postCmd('gamecmd', 'command.php');
            }, 100);
        }
    } catch (error) {
        console.error('Error in handleDialogueChoice:', error);
        // 如果出现任何错误，尝试直接提交命令
        try {
            var commandInput = document.getElementById('command');
            if(commandInput) {
                commandInput.value = 'dialogue_choice ' + dialogueId + ' ' + choiceIndex;
            }
            postCmd('gamecmd', 'command.php');
        } catch (finalError) {
            console.error('Final error attempt failed:', finalError);
        }
    }

    console.log('Dialogue choice submitted: dialogue_choice ' + dialogueId + ' ' + choiceIndex);

    return false;
}
