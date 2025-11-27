import axios from 'axios';
import dotenv from 'dotenv';
import readlineSync from 'readline-sync';
import { exec } from 'node:child_process';
import os from "os";

dotenv.config();

// API Model from OpenRouter
const MODEL_URL = process.env.MODEL_URL;
const MODEL = process.env.MODEL;
const API_KEY = process.env.API_KEY;

const HEADERS = {
  "Authorization": `Bearer ${API_KEY}`,
  "X-OpenRouter-Api-Key": API_KEY,
  "HTTP-Referer": "http://localhost",
  "X-Title": "CLI Agent",
  "Content-Type": "application/json",
};

const SYSTEM_PROMPT = `
You are an expert assistant with START, PLAN, ACTION, OBSERVATION and OUTPUT states.

STEP0: Before generating ANY shell command, the assistant MUST call detectOS tool to determine the OS. (Only once)

START → PLAN → ACTION → OBSERVATION → repeat if needed → OUTPUT.

Strictly follow JSON output format.

Available Tools:
- function getWeatherInfo(cityname)
- function executeCommand(command)
- function detectOS(): returns one of ["windows", "linux", "mac"]

RULES:
1. ALWAYS call detectOS BEFORE generating shell commands.
2. Based on detectOS output, generate OS-specific commands.

WINDOWS COMMAND EXAMPLES:
- mkdir folder
- New-Item -Path "folder\\file.txt" -ItemType File -Value "hello"
- Set-Content -Path "folder\\file.txt" -Value "hello"

LINUX/MAC COMMAND EXAMPLES:
- mkdir -p folder
- echo "hello" > folder/file.txt

The assistant must NEVER output commands for the wrong OS.
`;

// ------------------------ TOOL FUNCTIONS ------------------------

function executeCommand(command) {
  return new Promise((resolve) => {
    exec(command, (err, stdout, stderr) => {
      resolve({
        stdout,
        stderr,
        exit_code: err ? err.code : 0
      });
    });
  });
}

function getWeatherInfo(cityname) {
  return `${cityname} has 43°C (mock data)`;
}

function detectOS() {
  const platform = os.platform();

  // If running in Git Bash / WSL, treat as Windows
  if (process.env.OSTYPE?.includes("msys") || platform === "win32") {
    return "windows";
  }
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "mac";

  return "unknown";
}

const TOOLS_MAP = {
  getWeatherInfo,
  executeCommand,
  detectOS,
};

// ------------------------ API CALL FUNCTION ------------------------

async function callModel(data, messages) {
  try {
    const res = await axios.post(MODEL_URL, data, { headers: HEADERS });

    const reply = res.data.choices[0].message.content;
    messages.push({ role: "assistant", content: reply });

    console.log("\n------------------------------------");
    console.log("🤖 Raw model output:", reply);
    console.log("------------------------------------\n");

    return reply;

  } catch (error) {
    console.error("❌ OpenRouter Error:", error.response?.data || error.message);

    return JSON.stringify({
      type: "ERROR",
      content: error.message
    });
  }
}

// ------------------------ MAIN LOOP ------------------------

async function main() {
  const userQuery = readlineSync.question("What do you want me to do...? ");

  let messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ type: "user", user: userQuery }) }
  ];

  while (true) {

    const data = {
      model: MODEL,
      response_format: { type: "json_object" },
      messages,
    };

    const response = await callModel(data, messages);

    let call;
    try {
      call = JSON.parse(response);
    } catch (e) {
      console.error("❌ JSON PARSE ERROR:", response);
      break;
    }

    if (call.type === "OUTPUT") {
      console.log(`\n✅ agent: ${call.output}\n`);
      break;
    }

    // ----- ACTION -----
    if (call.state === "ACTION") {

      const fn = TOOLS_MAP[call.action.function];

      let input = null;

      // Handle 3 types:
      // 1. { arguments: { command: "..." } }
      // 2. { arguments: ["..."] }
      // 3. { command: "..." }
      if (typeof call.action.arguments === "object" && !Array.isArray(call.action.arguments)) {
        input = call.action.arguments.command ?? call.action.arguments;
      } else if (Array.isArray(call.action.arguments)) {
        input = call.action.arguments[0]; // take first element
      } else if (call.action.command) {
        input = call.action.command;
      }

      const observation = await fn(input);

      messages.push({
        role: "developer",
        content: JSON.stringify({
          state: "OBSERVATION",
          observation
        })
      });

      continue;
    }



    messages.push({
      role: "user",
      content: JSON.stringify(call)
    });
  }
}

main();
