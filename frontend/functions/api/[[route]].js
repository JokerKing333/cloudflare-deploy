/**
 * Cloudflare Pages Function - AI 问答系统后端 API
 * 放在 frontend/functions/ 目录下，Cloudflare Pages 会自动识别
 * 
 * 路由规则：
 *   /api/chat   → functions/api/chat.js
 *   /api/search → functions/api/search.js
 *   /api/models → functions/api/models.js
 */

// 注意：API 密钥通过 Cloudflare Dashboard 设置环境变量
// Pages → Settings → Environment variables → 添加 SILICONFLOW_API_KEY

export async function onRequest(context) {
  const { request, env } = context;
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

  // 聊天 API（流式响应）
  if (url.pathname === '/api/chat' && request.method === 'POST') {
    return handleChat(request, env);
  }

  // 搜索 API
  if (url.pathname === '/api/search' && request.method === 'POST') {
    return handleSearch(request, env);
  }

  // 模型信息 API
  if (url.pathname === '/api/models' && request.method === 'GET') {
    return handleModels(env);
  }

  return new Response('Not Found', { status: 404 });
}

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

  // 深拷贝消息
  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

  // 如果启用联网搜索，将搜索结果注入到最后一条用户消息
  if (enableSearch && apiMessages.length) {
    let lastUserMsg = null;
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === 'user') {
        lastUserMsg = apiMessages[i];
        break;
      }
    }

    if (lastUserMsg) {
      const searchContext = await buildSearchContext(lastUserMsg.content);
      if (searchContext) {
        lastUserMsg.content = lastUserMsg.content + searchContext;
      }
    }
  }

  // 创建流式响应
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  streamChat(writer, encoder, apiMessages, enableSearch, API_KEY).catch(err => {
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

/**
 * 流式调用硅基流动 API
 */
async function streamChat(writer, encoder, messages, enableSearch, apiKey) {
  try {
    if (enableSearch) {
      await writeSSE(writer, encoder, { type: 'search_start' });
    }

    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
        messages: messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      await writeSSE(writer, encoder, {
        type: 'error',
        content: `API 请求失败 (${response.status}): ${errorText}`,
      });
      await writeSSE(writer, encoder, '[DONE]');
      writer.close();
      return;
    }

    if (enableSearch) {
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

            // 思考链内容（DeepSeek-R1 特有）
            if (delta.reasoning_content) {
              await writeSSE(writer, encoder, {
                type: 'reasoning',
                content: delta.reasoning_content,
              });
            }

            // 正式回答内容
            if (delta.content) {
              await writeSSE(writer, encoder, {
                type: 'content',
                content: delta.content,
              });
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    await writeSSE(writer, encoder, '[DONE]');
    writer.close();
  } catch (error) {
    await writeSSE(writer, encoder, {
      type: 'error',
      content: error.message || '未知错误',
    });
    await writeSSE(writer, encoder, '[DONE]');
    writer.close();
  }
}

/**
 * 写入 SSE 格式数据
 */
async function writeSSE(writer, encoder, data) {
  if (typeof data === 'string') {
    await writer.write(encoder.encode(`data: ${data}\n\n`));
  } else {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  }
}

/**
 * 处理搜索请求
 */
async function handleSearch(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: '请求格式错误' }),
      { status: 400, headers: corsHeaders() }
    );
  }

  const query = body.query || '';
  if (!query) {
    return new Response(
      JSON.stringify({ error: '搜索关键词不能为空' }),
      { status: 400, headers: corsHeaders() }
    );
  }

  const results = await webSearch(query);
  return new Response(
    JSON.stringify({ results }),
    { headers: corsHeaders() }
  );
}

/**
 * 处理模型信息请求
 */
function handleModels(env) {
  return new Response(
    JSON.stringify({
      provider: 'siliconflow',
      model: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
      base_url: 'https://api.siliconflow.cn/v1',
    }),
    { headers: corsHeaders() }
  );
}

/**
 * DuckDuckGo 联网搜索
 */
async function webSearch(query, maxResults = 5) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    const resp = await fetch(url, {
      headers: { 'User-Agent': 'AI-Chat-Assistant/1.0' },
    });

    if (!resp.ok) return [];

    const data = await resp.json();
    const results = [];

    if (data.AbstractText) {
      results.push({
        title: data.AbstractSource || 'DuckDuckGo',
        url: data.AbstractURL || '',
        snippet: data.AbstractText,
      });
    }

    const topics = data.RelatedTopics || [];
    for (const topic of topics.slice(0, maxResults)) {
      if (topic && topic.Text) {
        results.push({
          title: (topic.FirstURL || '').split('/').pop().replace(/_/g, ' '),
          url: topic.FirstURL || '',
          snippet: topic.Text,
        });
      }
    }

    return results.slice(0, maxResults);
  } catch (error) {
    console.error('搜索出错:', error);
    return [];
  }
}

/**
 * 构建搜索上下文
 */
async function buildSearchContext(query) {
  const results = await webSearch(query);
  if (!results.length) return '';

  let context = '\n\n【以下是从互联网搜索到的相关信息，请参考这些信息回答用户问题】\n';
  results.forEach((r, i) => {
    context += `\n[${i + 1}] ${r.title}\n`;
    context += `    链接: ${r.url}\n`;
    context += `    摘要: ${r.snippet}\n`;
  });
  context += '\n【请基于以上搜索结果回答用户问题，并在回答末尾注明参考来源】\n';

  return context;
}

/**
 * CORS 响应头
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
