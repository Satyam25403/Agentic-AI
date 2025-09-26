import axios from 'axios';
import dotenv from 'dotenv';
import readlineSync from 'readline-sync';
import { exec } from 'node:child_process';

dotenv.config();
const MODEL_URL = process.env.MODEL_URL || 'http://localhost:12434/engines/v1/chat/completions';
const MODEL = process.env.MODEL || 'ai/gpt-oss:latest';


const SYSTEM_PROMPT = `
You are an expert assistant with START, PLAN, ACTION, OBSERVATION and OUTPUT states.
Do these steps iteratively to complete the user task.
START: Initial state where you receive the user prompt.
PLAN: Formulate a plan to achieve the user's goal using the Available Tools.
ACTION: Execute the plan by calling the appropriate Available Tools with necessary inputs.
OBSERVATION: Receive the OUTPUT from the ACTION taken. If the task is not complete, go back to PLAN with the new information and current state of the task. If the task is complete, proceed to OUTPUT.
OUTPUT: Return the AI response based on START prompt

Strictly follow JSON output format as shown in example

Available Tools:
- function getWeatherInfo(cityname): Returns the current weather details of the given city.
- function executeCommand(command): Executes the given shell command and returns the output.

Example:
START
{ "type": "user", "user": "What is the sum of weather of Patiala and Mohali?" }
{ "type": "PLAN", "plan": "I will call the getWeatherInfo for Patiala" }
{ "type": "ACTION", "function": "getWeatherInfo", "input": "patiala" }
{ "type": "OBSERVATION", "observation": "10°C" }
{ "type": "PLAN", "plan": "I will call getWeatherInfo for Mohali" }
{ "type": "ACTION", "function": "getWeatherInfo", "input": "mohali" }
{ "type": "OBSERVATION", "observation": "14°C" }
{ "type": "OUTPUT", "output": "The sum of weather of Patiala and Mohali is 24 degrees" }
`;

// ------------------------ TOOL FUNCTIONS ------------------------
function executeCommand(command) {
  return new Promise((resolve) => {
    exec(command, (err, stdout, stderr) => {
      if (err) {
        resolve(`Command failed: ${err.message}\nstdout: ${stdout}\nstderr: ${stderr}`);
      } else {
        resolve(`stdout: ${stdout}\nstderr: ${stderr}`);
      }
    });
  });
}

function getWeatherInfo(cityname) {
  return `${cityname} has 43°C (mock data)`; // mock data for testing
}

const TOOLS_MAP = {
  getWeatherInfo,
  executeCommand,
};

// ------------------------ HELPER FUNCTIONS ------------------------
async function callGroq(data,messages) {
  try {
    const res = await axios.post(
      MODEL_URL,
      data,
      { headers: { 'Content-Type': 'application/json' } }
    );
    const reply = res.data.choices[0].message.content;
    messages.push({ role: 'assistant', content: reply });
    console.log(`\n------------------------------------`)
    console.log('🤖 Raw model output:', reply);
    console.log(`------------------------------------\n`)
    return reply;
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    return JSON.stringify({ step: "ERROR", tool: "", input: "", content: error.message });
  }
}

// ------------------------ MAIN LOOP ------------------------
async function main() {
  const userQuery = readlineSync.question("What do you want me to do...? ");

  let messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ type: "user", user: userQuery }) }
  ];

  while (true) {
  const data = {
    model: MODEL,
    response_format: { type: 'json_object' },
    messages,
  };

  const response = await callGroq(data,messages);

  let call;
  try {
    call = JSON.parse(response);
  } catch (e) {
    console.error("Failed to parse model output:", response);
    break;
  }

  if (call.type === "OUTPUT") {
    console.log(`\n✅ agent: ${call.output}\n`);
    break;
  } else if (call.type === "ACTION") {
    const fn = TOOLS_MAP[call.function];
    const observation = await fn(call.input);
    const obs = { type: "OBSERVATION", observation };
    messages.push({ role: 'DEVELOPER', content: JSON.stringify(obs) });
  } else {
    // For PLAN or START types, we don't push as assistant yet
    messages.push({ role: 'user', content: JSON.stringify(call) });
  }
}

}

main();