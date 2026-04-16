const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = 3001;

const ANTHROPIC_BASE_URL = "http://localhost:8080";
const ANTHROPIC_API_KEY = "test";
const ANTHROPIC_VERSION = "2023-06-01";

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "openai-anthropic-bridge" });
});

app.get("/v1/models", async (_req, res) => {
  try {
    const response = await axios.get(`${ANTHROPIC_BASE_URL}/v1/models`, {
      headers: { "x-api-key": ANTHROPIC_API_KEY },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert OpenAI content format to Anthropic content format
function convertContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);

  return content.map((block) => {
    // Plain text block
    if (block.type === "text") return { type: "text", text: block.text };

    // OpenAI image_url block -> Anthropic base64 image block
    if (block.type === "image_url" && block.image_url?.url) {
      const url = block.image_url.url;
      if (url.startsWith("data:")) {
        // data:image/png;base64,<data>
        const [meta, data] = url.split(",");
        const media_type = meta.split(":")[1].split(";")[0];
        return {
          type: "image",
          source: { type: "base64", media_type, data },
        };
      }
    }

    // Already Anthropic-style image block
    if (block.type === "image") return block;

    // Fallback
    return { type: "text", text: block.text || "" };
  });
}

app.post("/v1/chat/completions", async (req, res) => {
  try {
    const {
      model,
      messages,
      max_tokens,
      max_completion_tokens,
      temperature,
    } = req.body;

    const systemMessages = (messages || []).filter((m) => m.role === "system");
    const nonSystemMessages = (messages || []).filter((m) => m.role !== "system");

    const systemPrompt = systemMessages
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : m.content.map((c) => c.text || "").join(""),
      )
      .join("\n")
      .trim();

    const anthropicMessages = nonSystemMessages.map((m) => ({
      role: m.role,
      content: convertContent(m.content),
    }));

    const body = {
      model,
      max_tokens: max_completion_tokens || max_tokens || 4096,
      messages: anthropicMessages,
      stream: true,
    };

    if (systemPrompt) body.system = systemPrompt;
    if (typeof temperature === "number") body.temperature = temperature;

    const response = await axios.post(
      `${ANTHROPIC_BASE_URL}/v1/messages`,
      body,
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        responseType: "stream",
      },
    );

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullText = "";
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;
    const msgId = `chatcmpl-${Date.now()}`;

    response.data.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event = JSON.parse(data);

          if (event.type === "message_start" && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens ?? 0;
            outputTokens = event.message.usage.output_tokens ?? 0;
          }

          if (event.type === "message_delta" && event.usage) {
            outputTokens = event.usage.output_tokens ?? outputTokens;
          }

          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta"
          ) {
            const text = event.delta.text;
            fullText += text;

            const chunk = {
              id: msgId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: text },
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }

          if (event.type === "message_stop") {
            const finalChunk = {
              id: msgId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            };
            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            console.log(`[${new Date().toISOString()}] model=${model} | prompt=${inputTokens} | completion=${outputTokens} | total=${inputTokens + outputTokens}`);
          }
        } catch (_) {}
      }
    });

    response.data.on("error", (err) => {
      console.error("Stream error:", err.message);
      res.end();
    });
  } catch (err) {
    console.error("Bridge error:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      error: err.response?.data || { message: err.message },
    });
  }
});

app.listen(PORT, () => {
  console.log(`Bridge running on http://localhost:${PORT}/v1`);
});
