# Anthropic-OpenAI Bridge

Converts OpenAI API format to Anthropic format so tools like Zed can use your local Anthropic proxy.

## Requirements

- Node.js 16+
- Anthropic proxy running on localhost:8080

## Setup

git clone, cd anthropic-bridge, npm install, npm start

Bridge runs on http://localhost:3001/v1

## Persistent with pm2

npm install -g pm2, pm2 start bridge.js --name zed-bridge, pm2 save, pm2 startup

## Zed Config

Add to ~/.config/zed/settings.json under language_models > openai_compatible.
Set api_url to http://localhost:3001/v1 and api_key to test.

## Endpoints

- POST /v1/chat/completions - OpenAI-compatible chat
- GET /v1/models - List available models
- GET /health - Health check
