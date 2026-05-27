/**
 * Cloudflare Worker - AI 问答系统后端 API
 * 同时托管静态前端文件
 * 
 * 模型适配说明：
 * - 当前使用 deepseek-ai/DeepSeek-R1-0528-Qwen3-8B（老版本 R1 模型）
 * - 该模型对联网搜索的 prompt 格式有特殊要求
 * - 搜索结果需要以更结构化的 system 消息注入，而非拼接到 user 消息
 */

// 模型配置
const MODEL_CONFIG = {
  model: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
  // 老版本 R1 模型可能不支持 reasoning_content，需要兼容处理
  supportsReasoning: true,
  // 老版本模型对搜索上下文的处理方式：'system' = 注入为 system 消息, 'user' = 拼接到 user 消息
  searchInjectionMode: 'system',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // API 路由
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, env);
    }
    if (url.pathname === '/api/search' && request.method === 'POST') {
      return handleSearch(request, env);
    }
    if (url.pathname === '/api/models' && request.method === 'GET') {
      return handleModels(env);
    }

    // 静态文件 - 由 Cloudflare 的 assets 功能自动处理
    return env.ASSETS.fetch(request);
  },
};

/**
 * 处理聊天请求 - 流式 SSE 响应
 */
async function handleChat(request, env) {
  const API_KEY = env.SILICONFLOW_API_KEY;
  if (!API_KEY) {
    return new Response(
      JSON.stringify({ error: '请先在 Cloudflare Dashboard 中设置 SILICONFLOW_API_KEY 环境变量' }),
      { status: 500, headers: corsHeaders() }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: '请求格式错误' }),
      { status: 400, headers: corsHeaders() }
    );
  }

  const messages = body.messages || [];
  const enableSearch = body.enable_search || false;

  if (!messages.length) {
    return new Response(
      JSON.stringify({ error: '消息不能为空' }),
      { status: 400, headers: corsHeaders() }
    );
  }

  // 构建 API 消息列表
  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

  // 联网搜索：根据模型配置选择注入方式
  let searchContext = '';
  if (enableSearch && apiMessages.length) {
    // 找到最后一条用户消息
    let lastUserMsg = null;
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === 'user') {
        lastUserMsg = apiMessages[i];
        break;
      }
    }
    if (lastUserMsg) {
      searchContext = await buildSearchContext(lastUserMsg.content);
      
      if (searchContext) {
        // 老版本模型适配：同时注入 system 消息和 user 消息
        // 因为老版本 R1 模型对 system 角色的支持不稳定
        // 双保险策略确保搜索上下文能被模型接收
        apiMessages.unshift({
          role: 'system',
          content: searchContext,
        });
        // 同时在用户消息末尾追加搜索提示（老版本模型更关注 user 消息）
        lastUserMsg.content = lastUserMsg.content + '\n\n[系统提示：请参考上述搜索结果回答，注意当前日期是' + getCurrentDate() + ']';
      } else {
        // 搜索失败时，至少注入当前日期信息，防止模型用过时日期
        apiMessages.unshift({
          role: 'system',
          content: '当前日期是' + getCurrentDate() + '。请基于你的知识回答用户问题，注意时效性。',
        });
        lastUserMsg.content = lastUserMsg.content + '\n\n[系统提示：当前日期是' + getCurrentDate() + '，请注意时效性]';
      }
    }
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  streamChat(writer, encoder, apiMessages, enableSearch, API_KEY, searchContext).catch(err => {
    console.error('Stream error:', err);
  });

  return new Response(readable, {
    headers: {
      ...corsHeaders(),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

async function streamChat(writer, encoder, messages, enableSearch, apiKey, searchContext) {
  try {
    // 发送搜索开始状态
    if (enableSearch && searchContext) {
      await writeSSE(writer, encoder, { type: 'search_start' });
    }

    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_CONFIG.model,
        messages: messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
        // 老版本 R1 模型兼容参数
        top_p: 0.9,
        frequency_penalty: 0,
        presence_penalty: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', response.status, errorText);
      await writeSSE(writer, encoder, {
        type: 'error',
        content: `API 请求失败 (${response.status}): ${errorText.substring(0, 200)}`,
      });
      await writeSSE(writer, encoder, '[DONE]');
      writer.close();
      return;
    }

    // 搜索完成
    if (enableSearch && searchContext) {
      await writeSSE(writer, encoder, { type: 'search_end' });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.choices && parsed.choices.length > 0) {
            const delta = parsed.choices[0].delta;
            
            // 老版本模型兼容：同时检查 reasoning_content 和 content
            // 某些老版本 R1 模型可能将思考内容放在 content 中而非 reasoning_content
            if (delta.reasoning_content) {
              await writeSSE(writer, encoder, { type: 'reasoning', content: delta.reasoning_content });
            }
            if (delta.content) {
              await writeSSE(writer, encoder, { type: 'content', content: delta.content });
            }
          }
        } catch (parseErr) {
          // 忽略解析错误，继续处理下一行
        }
      }
    }

    await writeSSE(writer, encoder, '[DONE]');
    writer.close();
  } catch (error) {
    console.error('Stream error:', error.message);
    await writeSSE(writer, encoder, { type: 'error', content: error.message || '未知错误' });
    await writeSSE(writer, encoder, '[DONE]');
    writer.close();
  }
}

async function writeSSE(writer, encoder, data) {
  if (typeof data === 'string') {
    await writer.write(encoder.encode(`data: ${data}\n\n`));
  } else {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  }
}

async function handleSearch(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: corsHeaders() });
  }

  const query = body.query || '';
  if (!query) {
    return new Response(JSON.stringify({ error: '搜索关键词不能为空' }), { status: 400, headers: corsHeaders() });
  }

  const results = await webSearch(query);
  return new Response(JSON.stringify({ results }), { headers: corsHeaders() });
}

function handleModels(env) {
  return new Response(
    JSON.stringify({
      provider: 'siliconflow',
      model: MODEL_CONFIG.model,
      base_url: 'https://api.siliconflow.cn/v1',
    }),
    { headers: corsHeaders() }
  );
}

/**
 * 联网搜索 - 多源搜索策略
 * 主搜索源：Bing 搜索（更可靠，Cloudflare Workers IP 不会被封）
 * 备用搜索源：DuckDuckGo Instant Answer API
 * 
 * 老版本模型适配：
 * - 搜索结果需要更简洁、更结构化的格式
 * - 限制摘要长度，避免 token 超限
 * - 优先返回高质量摘要
 */
async function webSearch(query, maxResults = 5) {
  // 先尝试 Bing 搜索（在 Cloudflare Workers 中更可靠）
  let results = await bingSearch(query, maxResults);
  
  // 如果 Bing 返回空结果，尝试 DuckDuckGo
  if (!results.length) {
    results = await duckduckgoSearch(query, maxResults);
  }
  
  // 如果 DuckDuckGo 也返回空，尝试 DuckDuckGo Lite
  if (!results.length) {
    results = await fallbackSearch(query, maxResults);
  }
  
  return results;
}

/**
 * Bing 搜索 - 通过 HTML 抓取
 * Bing 对 Cloudflare Workers IP 更友好
 */
async function bingSearch(query, maxResults) {
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    if (!resp.ok) return [];

    const html = await resp.text();
    const results = [];

    // 解析 Bing 搜索结果
    // Bing 结果格式: <li class="b_algo"><h2><a href="url">title</a></h2><p>snippet</p></li>
    const algoRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
    let algoMatch;
    
    while ((algoMatch = algoRegex.exec(html)) !== null && results.length < maxResults) {
      const block = algoMatch[1];
      
      // 提取标题和链接
      const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      // 提取摘要
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      
      if (titleMatch) {
        const url = titleMatch[1];
        const title = titleMatch[2].replace(/<[^>]*>/g, '').trim();
        const snippet = snippetMatch 
          ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() 
          : '';
        
        if (title && url && !url.includes('bing.com')) {
          results.push({
            title: truncateText(title, 80),
            url: url,
            snippet: truncateText(snippet, 300),
            source: 'Bing',
          });
        }
      }
    }

    return results;
  } catch (error) {
    console.error('Bing 搜索出错:', error.message);
    return [];
  }
}

/**
 * DuckDuckGo Instant Answer API
 */
async function duckduckgoSearch(query, maxResults) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, { 
      headers: { 
        'User-Agent': 'AI-Chat-Assistant/1.0',
        'Accept': 'application/json',
      } 
    });
    
    if (!resp.ok) return [];
    
    const data = await resp.json();
    const results = [];

    // 优先获取 Abstract（DuckDuckGo 精选摘要）
    if (data.AbstractText && data.AbstractText.trim()) {
      results.push({
        title: data.AbstractSource || 'DuckDuckGo',
        url: data.AbstractURL || '',
        snippet: truncateText(data.AbstractText, 300),
        source: 'DuckDuckGo',
      });
    }

    // 获取 RelatedTopics
    const topics = data.RelatedTopics || [];
    for (const topic of topics) {
      if (results.length >= maxResults) break;
      
      if (topic && topic.Text && topic.Text.trim()) {
        const title = topic.FirstURL 
          ? topic.FirstURL.split('/').pop().replace(/_/g, ' ').replace(/-/g, ' ')
          : '相关结果';
        results.push({
          title: truncateText(title, 80),
          url: topic.FirstURL || '',
          snippet: truncateText(topic.Text.replace(/<[^>]*>/g, ''), 300),
          source: 'DuckDuckGo',
        });
      }
    }

    return results.slice(0, maxResults);
  } catch (error) {
    console.error('DuckDuckGo 搜索出错:', error.message);
    return [];
  }
}

/**
 * 备用搜索 - 使用 DuckDuckGo HTML 搜索
 * 当 Instant Answer API 返回空结果时的降级方案
 */
async function fallbackSearch(query, maxResults) {
  try {
    // 使用 DuckDuckGo Lite 版本（更轻量，返回 HTML）
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!resp.ok) return [];

    const html = await resp.text();
    const results = [];

    // 解析 DuckDuckGo Lite 的 HTML 结果
    // 结果格式: <a href="url">title</a><span>snippet</span>
    const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const snippetRegex = /<span class="snippet"[^>]*>([^<]*)<\/span>/gi;
    
    let linkMatch;
    const links = [];
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      const url = linkMatch[1];
      const title = linkMatch[2].trim();
      // 过滤掉 DuckDuckGo 内部链接
      if (url && !url.includes('duckduckgo.com') && title && !title.includes('>')) {
        links.push({ url, title });
      }
    }

    let snippetMatch;
    const snippets = [];
    while ((snippetMatch = snippetRegex.exec(html)) !== null) {
      snippets.push(snippetMatch[1].trim());
    }

    // 配对链接和摘要
    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      results.push({
        title: truncateText(links[i].title, 80),
        url: links[i].url,
        snippet: truncateText(snippets[i] || '', 300),
        source: 'DuckDuckGo Lite',
      });
    }

    return results;
  } catch (error) {
    console.error('备用搜索出错:', error.message);
    return [];
  }
}

/**
 * 截断文本，确保不超过指定长度
 */
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * 获取当前日期字符串（北京时间）
 */
function getCurrentDate() {
  const now = new Date();
  // 转换为北京时间 (UTC+8)
  const bjTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = bjTime.getUTCFullYear();
  const month = String(bjTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bjTime.getUTCDate()).padStart(2, '0');
  const hours = String(bjTime.getUTCHours()).padStart(2, '0');
  const minutes = String(bjTime.getUTCMinutes()).padStart(2, '0');
  return `${year}年${month}月${day}日 ${hours}:${minutes}（北京时间）`;
}

/**
 * 构建搜索上下文 - 老版本模型适配版
 * 
 * 适配策略：
 * 1. 使用更简洁的格式，减少 token 消耗
 * 2. 明确指示模型如何使用搜索结果
 * 3. 限制上下文长度，避免超出老版本模型的上下文窗口
 * 4. 如果搜索结果为空，返回空字符串（不注入无效上下文）
 */
async function buildSearchContext(query) {
  const results = await webSearch(query, 5);
  
  if (!results.length) {
    console.log('搜索未返回结果，跳过上下文注入');
    return '';
  }

  // 老版本模型适配：使用更简洁的格式，并强调当前日期
  let context = `当前日期：${getCurrentDate()}\n\n`;
  context += '以下是用户问题「' + query + '」的网络搜索结果，你必须参考这些信息来回答：\n\n';
  context += '=== 搜索结果 ===\n';
  
  results.forEach((r, i) => {
    context += `[${i + 1}] ${r.title}\n`;
    if (r.url) {
      context += `来源: ${r.url}\n`;
    }
    context += `内容: ${r.snippet}\n\n`;
  });
  
  context += '=== 搜索结束 ===\n';
  context += '重要：你必须基于以上搜索结果回答用户问题。在回答中引用搜索到的信息，并注明来源。如果搜索结果与问题不相关，请说明并基于你的知识回答。';

  // 限制上下文总长度（老版本模型上下文窗口较小）
  const MAX_CONTEXT_LENGTH = 3000;
  if (context.length > MAX_CONTEXT_LENGTH) {
    context = context.substring(0, MAX_CONTEXT_LENGTH - 50) + '\n...(搜索结果已截断)\n=== 搜索结束 ===';
  }

  return context;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
