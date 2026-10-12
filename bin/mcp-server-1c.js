#!/usr/bin/env node

/**
 * 1C BSL AI Copilot MCP Server Executable.
 */

const path = require('path');
const { McpServer1C } = require(path.join(__dirname, '..', 'dist', 'mcp-server.js'));

const server = new McpServer1C();
server.start();
