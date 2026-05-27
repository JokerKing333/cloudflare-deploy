/**
 * AI 智能助手 - 前端交互逻辑
 * 支持：思考链展示、联网搜索
 */

// ========== 状态管理 ==========
const state = {
    conversations: [],      // 所有对话
    currentConversationId: null,  // 当前对话ID
    isStreaming: false,     // 是否正在流式响应
    sidebarCollapsed: false,
    enableSearch: false     // 是否启用联网搜索
};

// ========== DOM 元素 ==========
const elements = {
    sidebar: document.getElementById('sidebar'),
    chatHistory: document.getElementById('chatHistory'),
    chatContainer: document.getElementById('chatContainer'),
    welcomeScreen: document.getElementById('welcomeScreen'),
    messagesList: document.getElementById('messagesList'),
    thinkingIndicator: document.getElementById('thinkingIndicator'),
    thinkingText: document.getElementById('thinkingText'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    newChatBtn: document.getElementById('newChatBtn'),
    toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
    modelBadge: document.getElementById('modelBadge'),
    searchToggleBtn: document.getElementById('searchToggleBtn'),
};

// ========== 初始化 ==========
function init() {
    loadConversations();
    loadModelInfo();
    bindEvents();
    
    if (state.conversations.length > 0) {
        switchConversation(state.conversations[0].id);
    }
}

// 加载模型信息
async function loadModelInfo() {
    try {
        const res = await fetch('/api/models');
        const data = await res.json();
        elements.modelBadge.textContent = data.model || 'AI 模型';
    } catch (e) {
        elements.modelBadge.textContent = 'AI 模型';
    }
}

// 加载对话历史
function loadConversations() {
    try {
        const saved = localStorage.getItem('ai_conversations');
        if (saved) {
            state.conversations = JSON.parse(saved);
        }
    } catch (e) {
        state.conversations = [];
    }
    renderChatHistory();
}

// 保存对话历史
function saveConversations() {
    localStorage.setItem('ai_conversations', JSON.stringify(state.conversations));
}

// ========== 事件绑定 ==========
function bindEvents() {
    // 发送消息
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 自动调整输入框高度
    elements.messageInput.addEventListener('input', autoResizeInput);

    // 新建对话
    elements.newChatBtn.addEventListener('click', createNewChat);

    // 切换侧边栏
    elements.toggleSidebarBtn.addEventListener('click', toggleSidebar);

    // 联网搜索开关
    elements.searchToggleBtn.addEventListener('click', toggleSearch);

    // 建议卡片点击
    document.querySelectorAll('.suggestion-card').forEach(card => {
        card.addEventListener('click', () => {
            const prompt = card.dataset.prompt;
            elements.messageInput.value = prompt;
            sendMessage();
        });
    });
}

// ========== 联网搜索开关 ==========
function toggleSearch() {
    state.enableSearch = !state.enableSearch;
    if (state.enableSearch) {
        elements.searchToggleBtn.classList.add('active');
        elements.searchToggleBtn.title = '联网搜索已开启';
    } else {
        elements.searchToggleBtn.classList.remove('active');
        elements.searchToggleBtn.title = '联网搜索';
    }
}

// ========== 对话管理 ==========
function createNewChat() {
    const conversation = {
        id: Date.now().toString(),
        title: '新对话',
        messages: [],
        createdAt: new Date().toISOString()
    };
    state.conversations.unshift(conversation);
    state.currentConversationId = conversation.id;
    saveConversations();
    renderChatHistory();
    renderMessages();
    elements.welcomeScreen.style.display = 'flex';
    elements.messagesList.innerHTML = '';
}

function switchConversation(id) {
    state.currentConversationId = id;
    renderChatHistory();
    renderMessages();
}

function deleteConversation(id, e) {
    e.stopPropagation();
    state.conversations = state.conversations.filter(c => c.id !== id);
    
    if (state.currentConversationId === id) {
        if (state.conversations.length > 0) {
            state.currentConversationId = state.conversations[0].id;
        } else {
            state.currentConversationId = null;
        }
    }
    
    saveConversations();
    renderChatHistory();
    renderMessages();
    
    if (!state.currentConversationId) {
        elements.welcomeScreen.style.display = 'flex';
        elements.messagesList.innerHTML = '';
    }
}

function getCurrentConversation() {
    return state.conversations.find(c => c.id === state.currentConversationId);
}

// ========== 渲染 ==========
function renderChatHistory() {
    elements.chatHistory.innerHTML = state.conversations.map(conv => `
        <div class="chat-history-item ${conv.id === state.currentConversationId ? 'active' : ''}"
             onclick="switchConversation('${conv.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>${conv.title}</span>
            <button class="delete-btn" onclick="deleteConversation('${conv.id}', event)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    `).join('');
}

function renderMessages() {
    const conv = getCurrentConversation();
    
    if (!conv || conv.messages.length === 0) {
        elements.welcomeScreen.style.display = 'flex';
        elements.messagesList.innerHTML = '';
        return;
    }
    
    elements.welcomeScreen.style.display = 'none';
    
    elements.messagesList.innerHTML = conv.messages.map((msg, index) => {
        let thinkingHtml = '';
        if (msg.reasoning) {
            thinkingHtml = `
                <div class="thinking-chain">
                    <div class="thinking-chain-header" onclick="toggleThinkingChain(this)">
                        <svg class="brain-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1.5h-4v-1.5c-1.2-.7-2-2-2-3.5a4 4 0 0 1 4-4z"/>
                            <path d="M12 22v-8"/>
                            <path d="M8 14h8"/>
                        </svg>
                        <span class="thinking-label">思考过程</span>
                        <span class="arrow">▶</span>
                    </div>
                    <div class="thinking-chain-body">${formatMessage(msg.reasoning)}</div>
                </div>
            `;
        }
        
        return `
            <div class="message ${msg.role}" data-message-index="${index}">
                <div class="message-avatar">${msg.role === 'user' ? 'U' : 'AI'}</div>
                <div class="message-content">
                    <div class="message-header">
                        <div class="message-role">${msg.role === 'user' ? '你' : 'AI 助手'}</div>
                    </div>
                    ${thinkingHtml}
                    <div class="message-text">${formatMessage(msg.content)}</div>
                    <div class="message-actions">
                        <button class="msg-action-btn edit-btn" onclick="startEditMessage(${index})" title="编辑消息">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="msg-action-btn delete-btn" onclick="confirmDeleteMessage(${index})" title="删除消息">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    scrollToBottom();
}

function addMessageToUI(role, content, reasoning, index) {
    // 隐藏欢迎页
    elements.welcomeScreen.style.display = 'none';
    
    let thinkingHtml = '';
    if (reasoning) {
        thinkingHtml = `
            <div class="thinking-chain">
                <div class="thinking-chain-header" onclick="toggleThinkingChain(this)">
                    <svg class="brain-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1.5h-4v-1.5c-1.2-.7-2-2-2-3.5a4 4 0 0 1 4-4z"/>
                        <path d="M12 22v-8"/>
                        <path d="M8 14h8"/>
                    </svg>
                    <span class="thinking-label">思考过程</span>
                    <span class="arrow">▶</span>
                </div>
                <div class="thinking-chain-body">${formatMessage(reasoning)}</div>
            </div>
        `;
    }
    
    const msgIndex = index !== undefined ? index : (getCurrentConversation()?.messages.length || 0);
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    messageDiv.setAttribute('data-message-index', msgIndex);
    messageDiv.innerHTML = `
        <div class="message-avatar">${role === 'user' ? 'U' : 'AI'}</div>
        <div class="message-content">
            <div class="message-header">
                <div class="message-role">${role === 'user' ? '你' : 'AI 助手'}</div>
            </div>
            ${thinkingHtml}
            <div class="message-text">${formatMessage(content)}</div>
            <div class="message-actions">
                <button class="msg-action-btn edit-btn" onclick="startEditMessage(${msgIndex})" title="编辑消息">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="msg-action-btn delete-btn" onclick="confirmDeleteMessage(${msgIndex})" title="删除消息">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </div>
    `;
    elements.messagesList.appendChild(messageDiv);
    scrollToBottom();
    return messageDiv;
}

function scrollToBottom() {
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

// ========== 思考链折叠/展开 ==========
function toggleThinkingChain(header) {
    const body = header.nextElementSibling;
    const arrow = header.querySelector('.arrow');
    const isOpen = body.classList.contains('open');
    
    if (isOpen) {
        body.classList.remove('open');
        arrow.classList.remove('open');
    } else {
        body.classList.add('open');
        arrow.classList.add('open');
    }
}

// ========== 代码块ID计数器 ==========
let codeBlockIdCounter = 0;

// ========== 消息格式化（简单Markdown） ==========
function formatMessage(text) {
    if (!text) return '';
    
    // 转义HTML
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // 代码块 (```...```) - 渲染为带操作按钮的组件
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        const codeId = 'code-' + (++codeBlockIdCounter);
        const langLabel = lang || 'code';
        const trimmedCode = code.trim();
        // 对代码内容进行HTML转义（已在外部处理，这里需要反转义后重新处理）
        const escapedCode = trimmedCode
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        
        // 重新转义用于安全展示
        const safeCode = escapedCode
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        return `
            <div class="code-block-wrapper" data-code-id="${codeId}">
                <div class="code-block-header">
                    <span class="code-lang-label">${langLabel}</span>
                    <div class="code-block-actions">
                        <button class="code-action-btn copy-btn" onclick="copyCodeBlock('${codeId}')" title="复制代码">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            <span>复制</span>
                        </button>
                        <button class="code-action-btn download-btn" onclick="downloadCodeBlock('${codeId}')" title="下载代码">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            <span>下载</span>
                        </button>
                    </div>
                </div>
                <div class="code-block-body">
                    <pre><code class="language-${langLabel}">${safeCode}</code></pre>
                </div>
            </div>`;
    });
    
    // 行内代码 (`...`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 粗体 (**...**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // 斜体 (*...*)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // 无序列表
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    
    // 有序列表
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    
    // 引用
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    
    // 水平线
    html = html.replace(/^---$/gm, '<hr>');
    
    // 换行
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    
    // 包裹段落
    if (!html.startsWith('<')) {
        html = '<p>' + html + '</p>';
    }
    
    return html;
}

/**
 * 流式渲染格式化 - 处理可能未闭合的代码块
 * 在流式输出过程中，代码块可能只有开头的 ``` 而没有结尾的 ```
 */
function formatMessageStreaming(text) {
    if (!text) return '';
    
    // 转义HTML
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // 已闭合的代码块 (```...```) - 渲染为带操作按钮的组件
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        const codeId = 'code-' + (++codeBlockIdCounter);
        const langLabel = lang || 'code';
        const trimmedCode = code.trim();
        const escapedCode = trimmedCode
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        const safeCode = escapedCode
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        return `
            <div class="code-block-wrapper" data-code-id="${codeId}">
                <div class="code-block-header">
                    <span class="code-lang-label">${langLabel}</span>
                    <div class="code-block-actions">
                        <button class="code-action-btn copy-btn" onclick="copyCodeBlock('${codeId}')" title="复制代码">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            <span>复制</span>
                        </button>
                        <button class="code-action-btn download-btn" onclick="downloadCodeBlock('${codeId}')" title="下载代码">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            <span>下载</span>
                        </button>
                    </div>
                </div>
                <div class="code-block-body">
                    <pre><code class="language-${langLabel}">${safeCode}</code></pre>
                </div>
            </div>`;
    });
    
    // 未闭合的代码块 (```lang\ncode... 没有结尾的 ```)
    // 将其渲染为临时代码块（流式输出中）
    html = html.replace(/```(\w*)\n([\s\S]*?)$/gm, (match, lang, code) => {
        const codeId = 'code-streaming-' + (++codeBlockIdCounter);
        const langLabel = lang || 'code';
        const safeCode = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        return `
            <div class="code-block-wrapper streaming" data-code-id="${codeId}">
                <div class="code-block-header">
                    <span class="code-lang-label">${langLabel}</span>
                    <div class="code-block-actions">
                        <span class="streaming-badge">输出中...</span>
                    </div>
                </div>
                <div class="code-block-body">
                    <pre><code class="language-${langLabel}">${safeCode}</code></pre>
                </div>
            </div>`;
    });
    
    // 行内代码 (`...`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 粗体 (**...**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // 斜体 (*...*)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // 无序列表
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    
    // 有序列表
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    
    // 引用
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    
    // 水平线
    html = html.replace(/^---$/gm, '<hr>');
    
    // 换行
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    
    // 包裹段落
    if (!html.startsWith('<')) {
        html = '<p>' + html + '</p>';
    }
    
    return html;
}

// ========== 代码块操作 ==========

/**
 * 复制代码块内容到剪贴板
 */
function copyCodeBlock(codeId) {
    const wrapper = document.querySelector(`.code-block-wrapper[data-code-id="${codeId}"]`);
    if (!wrapper) return;
    
    const codeElement = wrapper.querySelector('code');
    if (!codeElement) return;
    
    // 获取原始代码文本（反转义HTML实体）
    const rawCode = codeElement.textContent || codeElement.innerText || '';
    
    // 使用 Clipboard API 复制
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(rawCode).then(() => {
            showCopySuccess(wrapper);
        }).catch(() => {
            fallbackCopy(rawCode, wrapper);
        });
    } else {
        fallbackCopy(rawCode, wrapper);
    }
}

/**
 * 降级复制方案（兼容旧浏览器）
 */
function fallbackCopy(text, wrapper) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    
    try {
        document.execCommand('copy');
        showCopySuccess(wrapper);
    } catch (e) {
        // 复制失败，静默处理
    }
    
    document.body.removeChild(textarea);
}

/**
 * 显示复制成功提示
 */
function showCopySuccess(wrapper) {
    const copyBtn = wrapper.querySelector('.copy-btn');
    if (!copyBtn) return;
    
    // 更新按钮状态
    copyBtn.classList.add('copied');
    const spanEl = copyBtn.querySelector('span');
    const originalText = spanEl ? spanEl.textContent : '复制';
    
    if (spanEl) spanEl.textContent = '已复制';
    
    // 更新SVG为勾号
    const svgEl = copyBtn.querySelector('svg');
    if (svgEl) {
        svgEl.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
    }
    
    // 2秒后恢复
    setTimeout(() => {
        copyBtn.classList.remove('copied');
        if (spanEl) spanEl.textContent = originalText;
        if (svgEl) {
            svgEl.innerHTML = `
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            `;
        }
    }, 2000);
}

/**
 * 下载代码块内容为本地文件
 */
function downloadCodeBlock(codeId) {
    const wrapper = document.querySelector(`.code-block-wrapper[data-code-id="${codeId}"]`);
    if (!wrapper) return;
    
    const codeElement = wrapper.querySelector('code');
    if (!codeElement) return;
    
    // 获取原始代码文本
    const rawCode = codeElement.textContent || codeElement.innerText || '';
    
    // 获取语言标签，用于确定文件扩展名
    const langLabel = wrapper.querySelector('.code-lang-label');
    const lang = langLabel ? langLabel.textContent.trim().toLowerCase() : '';
    
    // 语言到扩展名的映射
    const extMap = {
        'python': '.py', 'py': '.py',
        'javascript': '.js', 'js': '.js',
        'typescript': '.ts', 'ts': '.ts',
        'html': '.html',
        'css': '.css',
        'java': '.java',
        'c': '.c',
        'cpp': '.cpp', 'c++': '.cpp',
        'csharp': '.cs', 'c#': '.cs',
        'go': '.go',
        'rust': '.rs',
        'ruby': '.rb',
        'php': '.php',
        'swift': '.swift',
        'kotlin': '.kt',
        'sql': '.sql',
        'shell': '.sh', 'bash': '.sh',
        'json': '.json',
        'xml': '.xml',
        'yaml': '.yml', 'yml': '.yml',
        'markdown': '.md', 'md': '.md',
    };
    
    const ext = extMap[lang] || '.txt';
    const filename = `code${ext}`;
    
    // 创建 Blob 并触发下载
    const blob = new Blob([rawCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // 下载按钮短暂反馈
    const downloadBtn = wrapper.querySelector('.download-btn');
    if (downloadBtn) {
        const spanEl = downloadBtn.querySelector('span');
        if (spanEl) {
            const originalText = spanEl.textContent;
            spanEl.textContent = '已下载';
            setTimeout(() => {
                spanEl.textContent = originalText;
            }, 1500);
        }
    }
}

// ========== 发送消息 ==========
async function sendMessage() {
    const content = elements.messageInput.value.trim();
    if (!content || state.isStreaming) return;
    
    // 如果没有当前对话，创建新对话
    if (!state.currentConversationId) {
        createNewChat();
    }
    
    const conv = getCurrentConversation();
    if (!conv) return;
    
    // 更新对话标题
    if (conv.messages.length === 0) {
        conv.title = content.length > 20 ? content.substring(0, 20) + '...' : content;
    }
    
    // 添加用户消息
    const userMessage = { role: 'user', content };
    conv.messages.push(userMessage);
    addMessageToUI('user', content);
    
    // 清空输入框
    elements.messageInput.value = '';
    autoResizeInput();
    
    // 禁用发送按钮
    state.isStreaming = true;
    elements.sendBtn.disabled = true;
    elements.thinkingIndicator.style.display = 'flex';
    elements.thinkingText.textContent = state.enableSearch ? '正在搜索并思考...' : 'AI 正在思考...';
    
    // 准备发送给API的消息
    const apiMessages = conv.messages.map(m => ({
        role: m.role,
        content: m.content
    }));
    
    // 创建AI消息占位
    const aiMessageDiv = addMessageToUI('assistant', '');
    const aiTextDiv = aiMessageDiv.querySelector('.message-text');
    const aiContentDiv = aiMessageDiv.querySelector('.message-content');
    let aiContent = '';
    let aiReasoning = '';
    let thinkingChainDiv = null;
    let thinkingBodyDiv = null;
    let searchStatusDiv = null;
    
    // iOS Safari 兼容：使用 AbortController 设置超时
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
        abortController.abort();
    }, 120000); // 2分钟超时（iOS Safari 默认超时较短）
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                messages: apiMessages,
                enable_search: state.enableSearch 
            }),
            signal: abortController.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        // iOS Safari 兼容：检查 response.body 是否存在
        if (!response.body) {
            throw new Error('浏览器不支持流式响应（response.body 为空），请尝试刷新页面');
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        elements.thinkingIndicator.style.display = 'none';
        
        // iOS 心跳检测：如果 30 秒没收到数据，认为连接断开
        let lastDataTime = Date.now();
        const heartbeatCheck = setInterval(() => {
            if (Date.now() - lastDataTime > 35000) {
                console.warn('SSE 心跳超时，可能连接已断开');
                reader.cancel();
                clearInterval(heartbeatCheck);
            }
        }, 5000);
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            lastDataTime = Date.now();
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    
                    if (data === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        
                        // 心跳消息，忽略
                        if (parsed.type === 'heartbeat') continue;
                        
                        // 处理错误
                        if (parsed.type === 'error') {
                            aiContent = `❌ 错误: ${parsed.content}`;
                            aiTextDiv.innerHTML = formatMessage(aiContent);
                        }
                        
                        // 处理搜索状态
                        if (parsed.type === 'search_start') {
                            searchStatusDiv = document.createElement('div');
                            searchStatusDiv.className = 'search-status';
                            searchStatusDiv.innerHTML = `
                                <div class="search-spinner"></div>
                                <span>正在搜索网络...</span>
                            `;
                            aiContentDiv.insertBefore(searchStatusDiv, aiTextDiv);
                        }
                        
                        if (parsed.type === 'search_end' && searchStatusDiv) {
                            searchStatusDiv.classList.add('done');
                            searchStatusDiv.innerHTML = `
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                <span>搜索完成</span>
                            `;
                        }
                        
                        // 处理思考链内容
                        if (parsed.type === 'reasoning') {
                            aiReasoning += parsed.content;
                            
                            if (!thinkingChainDiv) {
                                thinkingChainDiv = document.createElement('div');
                                thinkingChainDiv.className = 'thinking-chain';
                                thinkingChainDiv.innerHTML = `
                                    <div class="thinking-chain-header" onclick="toggleThinkingChain(this)">
                                        <svg class="brain-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1.5h-4v-1.5c-1.2-.7-2-2-2-3.5a4 4 0 0 1 4-4z"/>
                                            <path d="M12 22v-8"/>
                                            <path d="M8 14h8"/>
                                        </svg>
                                        <span class="thinking-label">思考过程</span>
                                        <span class="arrow open">▶</span>
                                    </div>
                                    <div class="thinking-chain-body open"></div>
                                `;
                                thinkingBodyDiv = thinkingChainDiv.querySelector('.thinking-chain-body');
                                aiContentDiv.insertBefore(thinkingChainDiv, aiTextDiv);
                            }
                            
                            thinkingBodyDiv.innerHTML = formatMessage(aiReasoning);
                            scrollToBottom();
                        }
                        
                        // 处理正式回答内容
                        if (parsed.type === 'content') {
                            aiContent += parsed.content;
                            aiTextDiv.innerHTML = formatMessageStreaming(aiContent);
                            scrollToBottom();
                        }
                        
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }
        
        clearInterval(heartbeatCheck);
        
        // 流式结束后，用完整格式化重新渲染
        aiTextDiv.innerHTML = formatMessage(aiContent);
        
        // 保存AI消息
        const aiMessage = { role: 'assistant', content: aiContent };
        if (aiReasoning) {
            aiMessage.reasoning = aiReasoning;
        }
        conv.messages.push(aiMessage);
        saveConversations();
        renderChatHistory();
        
    } catch (error) {
        clearTimeout(timeoutId);
        elements.thinkingIndicator.style.display = 'none';
        
        // 区分超时和网络错误
        if (error.name === 'AbortError') {
            aiContent = '⏱️ 请求超时，请检查网络连接后重试';
        } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
            aiContent = '🌐 网络连接失败，请检查网络后重试（iOS 用户请确保未开启"阻止跨站跟踪"）';
        } else {
            aiContent = `❌ 请求失败: ${error.message}`;
        }
        aiTextDiv.innerHTML = formatMessage(aiContent);
        conv.messages.push({ role: 'assistant', content: aiContent });
        saveConversations();
    }
    
    state.isStreaming = false;
    elements.sendBtn.disabled = false;
    elements.messageInput.focus();
}

// ========== 工具函数 ==========
function autoResizeInput() {
    const input = elements.messageInput;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
}

function toggleSidebar() {
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        // 移动端：使用 mobile-open class 控制滑入/滑出
        const isOpen = elements.sidebar.classList.contains('mobile-open');
        if (isOpen) {
            closeMobileSidebar();
        } else {
            openMobileSidebar();
        }
    } else {
        // 桌面端：使用 collapsed class
        state.sidebarCollapsed = !state.sidebarCollapsed;
        if (state.sidebarCollapsed) {
            elements.sidebar.classList.add('collapsed');
        } else {
            elements.sidebar.classList.remove('collapsed');
        }
    }
}

function openMobileSidebar() {
    elements.sidebar.classList.add('mobile-open');
    // 创建遮罩层
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', closeMobileSidebar);
    }
    overlay.classList.add('visible');
    // 阻止背景滚动
    document.body.style.overflow = 'hidden';
}

function closeMobileSidebar() {
    elements.sidebar.classList.remove('mobile-open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
        overlay.classList.remove('visible');
    }
    // 恢复滚动
    document.body.style.overflow = '';
}

// ========== 消息管理：删除、编辑 ==========

/**
 * 确认删除消息 - 显示二次确认弹窗
 */
function confirmDeleteMessage(index) {
    if (state.isStreaming) return;
    
    const conv = getCurrentConversation();
    if (!conv || index < 0 || index >= conv.messages.length) return;
    
    const msg = conv.messages[index];
    const preview = msg.content.length > 50 ? msg.content.substring(0, 50) + '...' : msg.content;
    
    showConfirmDialog(
        '确认删除',
        `<p>确定要删除这条消息吗？</p><p class="confirm-preview">"${escapeHtml(preview)}"</p><p class="confirm-hint">此操作不可撤销</p>`,
        () => {
            deleteMessage(index);
        }
    );
}

/**
 * 执行删除消息
 */
function deleteMessage(index) {
    const conv = getCurrentConversation();
    if (!conv) return;
    
    // 删除消息
    conv.messages.splice(index, 1);
    saveConversations();
    
    // 更新对话标题
    if (conv.messages.length === 0) {
        conv.title = '新对话';
    } else {
        const firstUserMsg = conv.messages.find(m => m.role === 'user');
        if (firstUserMsg) {
            conv.title = firstUserMsg.content.length > 20 
                ? firstUserMsg.content.substring(0, 20) + '...' 
                : firstUserMsg.content;
        }
    }
    
    saveConversations();
    renderChatHistory();
    renderMessages();
    
    // 如果消息全部删除，显示欢迎页
    if (conv.messages.length === 0) {
        elements.welcomeScreen.style.display = 'flex';
        elements.messagesList.innerHTML = '';
    }
}

/**
 * 开始编辑消息
 */
function startEditMessage(index) {
    if (state.isStreaming) return;
    
    const conv = getCurrentConversation();
    if (!conv || index < 0 || index >= conv.messages.length) return;
    
    const msg = conv.messages[index];
    const messageEl = document.querySelector(`.message[data-message-index="${index}"]`);
    if (!messageEl) return;
    
    const textDiv = messageEl.querySelector('.message-text');
    if (!textDiv) return;
    
    // 保存原始内容用于取消
    const originalContent = msg.content;
    
    // 获取纯文本内容（去除HTML标签）
    const plainText = msg.content;
    
    // 替换为编辑区域
    textDiv.innerHTML = `
        <div class="edit-area">
            <textarea class="edit-textarea">${escapeHtml(plainText)}</textarea>
            <div class="edit-actions">
                <button class="edit-save-btn" onclick="saveEditMessage(${index}, this)">保存</button>
                <button class="edit-cancel-btn" onclick="cancelEditMessage(${index}, this)">取消</button>
            </div>
        </div>
    `;
    
    // 聚焦并选中文本
    const textarea = textDiv.querySelector('.edit-textarea');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    
    // 自动调整高度
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';
    });
    
    // 支持 Ctrl+Enter 保存
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            saveEditMessage(index, textDiv.querySelector('.edit-save-btn'));
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            cancelEditMessage(index, textDiv.querySelector('.edit-cancel-btn'));
        }
    });
}

/**
 * 保存编辑后的消息
 */
function saveEditMessage(index, btnEl) {
    const conv = getCurrentConversation();
    if (!conv) return;
    
    const messageEl = document.querySelector(`.message[data-message-index="${index}"]`);
    if (!messageEl) return;
    
    const textarea = messageEl.querySelector('.edit-textarea');
    if (!textarea) return;
    
    const newContent = textarea.value.trim();
    if (!newContent) {
        // 内容为空，提示用户
        textarea.style.borderColor = '#ff6b6b';
        textarea.focus();
        return;
    }
    
    const oldContent = conv.messages[index].content;
    const contentChanged = (oldContent !== newContent);
    
    // 更新消息内容
    conv.messages[index].content = newContent;
    
    // 如果是用户消息且是第一条，更新对话标题
    if (conv.messages[index].role === 'user') {
        const firstUserMsg = conv.messages.find(m => m.role === 'user');
        if (firstUserMsg && firstUserMsg === conv.messages[index]) {
            conv.title = newContent.length > 20 
                ? newContent.substring(0, 20) + '...' 
                : newContent;
        }
    }
    
    // 检测：如果编辑的消息后面还有消息，需要截断后续对话
    const msg = conv.messages[index];
    const hasMessagesAfter = (index + 1 < conv.messages.length);
    const hasAiReplyAfter = hasMessagesAfter && (conv.messages[index + 1].role === 'assistant');
    
    if (msg.role === 'user' && hasAiReplyAfter && contentChanged) {
        // 用户消息被修改 + 后面有AI回复 → 截断并重新生成
        conv.messages = conv.messages.slice(0, index + 1);
        saveConversations();
        renderChatHistory();
        renderMessages();
        
        // 自动触发AI重新生成回答
        regenerateAiResponse(index);
    } else if (hasMessagesAfter && contentChanged) {
        // 其他情况（如编辑AI消息后内容变了）→ 截断后续对话
        conv.messages = conv.messages.slice(0, index + 1);
        saveConversations();
        renderChatHistory();
        renderMessages();
    } else {
        saveConversations();
        renderChatHistory();
        renderMessages();
    }
}

/**
 * 基于编辑后的用户消息，重新生成AI回答
 * 截断对话到指定位置，然后触发流式生成
 */
async function regenerateAiResponse(userMsgIndex) {
    if (state.isStreaming) return;
    
    const conv = getCurrentConversation();
    if (!conv) return;
    
    state.isStreaming = true;
    elements.sendBtn.disabled = true;
    elements.thinkingIndicator.style.display = 'flex';
    elements.thinkingText.textContent = state.enableSearch ? '正在搜索并重新生成...' : 'AI 正在重新生成...';
    
    // 准备发送给API的消息（只包含到当前用户消息为止的上下文）
    const apiMessages = conv.messages.map(m => ({
        role: m.role,
        content: m.content
    }));
    
    // 创建AI消息占位
    const aiMessageDiv = addMessageToUI('assistant', '');
    const aiTextDiv = aiMessageDiv.querySelector('.message-text');
    const aiContentDiv = aiMessageDiv.querySelector('.message-content');
    let aiContent = '';
    let aiReasoning = '';
    let thinkingChainDiv = null;
    let thinkingBodyDiv = null;
    let searchStatusDiv = null;
    
    // iOS Safari 兼容：使用 AbortController 设置超时
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
        abortController.abort();
    }, 120000);
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                messages: apiMessages,
                enable_search: state.enableSearch 
            }),
            signal: abortController.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        // iOS Safari 兼容：检查 response.body 是否存在
        if (!response.body) {
            throw new Error('浏览器不支持流式响应（response.body 为空），请尝试刷新页面');
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        elements.thinkingIndicator.style.display = 'none';
        
        let lastDataTime = Date.now();
        const heartbeatCheck = setInterval(() => {
            if (Date.now() - lastDataTime > 35000) {
                reader.cancel();
                clearInterval(heartbeatCheck);
            }
        }, 5000);
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            lastDataTime = Date.now();
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    
                    if (data === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        
                        if (parsed.type === 'heartbeat') continue;
                        
                        if (parsed.type === 'error') {
                            aiContent = `❌ 错误: ${parsed.content}`;
                            aiTextDiv.innerHTML = formatMessage(aiContent);
                        }
                        
                        if (parsed.type === 'search_start') {
                            searchStatusDiv = document.createElement('div');
                            searchStatusDiv.className = 'search-status';
                            searchStatusDiv.innerHTML = `
                                <div class="search-spinner"></div>
                                <span>正在搜索网络...</span>
                            `;
                            aiContentDiv.insertBefore(searchStatusDiv, aiTextDiv);
                        }
                        
                        if (parsed.type === 'search_end' && searchStatusDiv) {
                            searchStatusDiv.classList.add('done');
                            searchStatusDiv.innerHTML = `
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                <span>搜索完成</span>
                            `;
                        }
                        
                        if (parsed.type === 'reasoning') {
                            aiReasoning += parsed.content;
                            
                            if (!thinkingChainDiv) {
                                thinkingChainDiv = document.createElement('div');
                                thinkingChainDiv.className = 'thinking-chain';
                                thinkingChainDiv.innerHTML = `
                                    <div class="thinking-chain-header" onclick="toggleThinkingChain(this)">
                                        <svg class="brain-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1.5h-4v-1.5c-1.2-.7-2-2-2-3.5a4 4 0 0 1 4-4z"/>
                                            <path d="M12 22v-8"/>
                                            <path d="M8 14h8"/>
                                        </svg>
                                        <span class="thinking-label">思考过程</span>
                                        <span class="arrow open">▶</span>
                                    </div>
                                    <div class="thinking-chain-body open"></div>
                                `;
                                thinkingBodyDiv = thinkingChainDiv.querySelector('.thinking-chain-body');
                                aiContentDiv.insertBefore(thinkingChainDiv, aiTextDiv);
                            }
                            
                            thinkingBodyDiv.innerHTML = formatMessage(aiReasoning);
                            scrollToBottom();
                        }
                        
                        if (parsed.type === 'content') {
                            aiContent += parsed.content;
                            aiTextDiv.innerHTML = formatMessageStreaming(aiContent);
                            scrollToBottom();
                        }
                        
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }
        
        clearInterval(heartbeatCheck);
        
        aiTextDiv.innerHTML = formatMessage(aiContent);
        
        const aiMessage = { role: 'assistant', content: aiContent };
        if (aiReasoning) {
            aiMessage.reasoning = aiReasoning;
        }
        conv.messages.push(aiMessage);
        saveConversations();
        renderChatHistory();
        
    } catch (error) {
        clearTimeout(timeoutId);
        elements.thinkingIndicator.style.display = 'none';
        
        if (error.name === 'AbortError') {
            aiContent = '⏱️ 请求超时，请检查网络连接后重试';
        } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
            aiContent = '🌐 网络连接失败，请检查网络后重试（iOS 用户请确保未开启"阻止跨站跟踪"）';
        } else {
            aiContent = `❌ 请求失败: ${error.message}`;
        }
        aiTextDiv.innerHTML = formatMessage(aiContent);
        conv.messages.push({ role: 'assistant', content: aiContent });
        saveConversations();
    }
    
    state.isStreaming = false;
    elements.sendBtn.disabled = false;
    elements.messageInput.focus();
}

/**
 * 取消编辑消息
 */
function cancelEditMessage(index, btnEl) {
    // 直接重新渲染恢复原内容
    renderMessages();
}

/**
 * 显示确认对话框
 */
function showConfirmDialog(title, messageHtml, onConfirm) {
    // 移除已有弹窗
    const existing = document.querySelector('.confirm-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
        <div class="confirm-dialog">
            <div class="confirm-header">
                <h3>${title}</h3>
            </div>
            <div class="confirm-body">
                ${messageHtml}
            </div>
            <div class="confirm-footer">
                <button class="confirm-cancel-btn">取消</button>
                <button class="confirm-ok-btn">确认删除</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    // 动画入场
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
    });
    
    // 关闭函数
    const closeDialog = () => {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 200);
    };
    
    // 绑定事件
    overlay.querySelector('.confirm-cancel-btn').addEventListener('click', closeDialog);
    overlay.querySelector('.confirm-ok-btn').addEventListener('click', () => {
        closeDialog();
        onConfirm();
    });
    
    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDialog();
    });
    
    // ESC 关闭
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeDialog();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

/**
 * HTML转义工具函数
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== 启动 ==========
document.addEventListener('DOMContentLoaded', init);
