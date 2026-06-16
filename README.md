# AgentSSNND0
AgentSSNND0 is a versatile, open-source AI assistant packaged as a Chrome Extension. It functions as both a powerful chat interface and an autonomous web agent, capable of interacting with websites to perform tasks on your behalf. It supports multiple AI backends and is designed for deep customization.

## Features

*   **Dual Operation Modes**:
    *   **Chat Mode**: A standard conversational interface for direct interaction with your chosen AI model.
    *   **Agent Mode**: An autonomous mode that can understand a task, observe a web page, and execute a series of actions (clicking, typing, scrolling) to accomplish a goal.

*   **Autonomous Web Agent**: The agent uses the Chrome DevTools Protocol (CDP) to perceive and interact with web pages. Its capabilities include:
    *   `click`: Clicks on elements.
    *   `type`: Types text into input fields.
    *   `select`: Chooses options from dropdowns.
    *   `scroll`: Scrolls the page.
    *   `navigate`: Navigates to a new URL.
    *   `search`: Performs a web search.
    *   `extract`: Extracts text content from elements.
    *   `switchTab`: Switches between tabs within its designated group.
    *   `done`: Marks a task as complete with a summary.

*   **Extensive Backend Support**: Connect to a variety of AI providers. Out-of-the-box support includes:
    *   Anthropic
    *   OpenRouter
    *   OpenAI
    *   Gemini
    *   DeepSeek
    *   Mistral
    *   Custom OpenAI-compatible API gateways.

*   **Rich Command Palette**: Use the `/` key in the input field to access a quick-action command palette for tasks like switching models, loading presets, and clearing the conversation.

*   **Deep Customization**:
    *   **Skills**: Define custom prompt templates for repeatable tasks (e.g., `/skill translate`).
    *   **Preprompts**: Save and quickly switch between different system prompts.
    *   **Presets**: Save entire configurations (model, temperature, system prompt) and load them with a single command.

*   **Secure & Local**: Your API keys are stored locally in your browser's storage and are never transmitted to any server except the API provider you have configured.

*   **Integrated Side Panel**: Access the assistant anytime via the Chrome side panel using the `Ctrl+E` (or `Cmd+E` on Mac) shortcut.

## Getting Started

### Prerequisites

*   Google Chrome (Version 116 or newer).
*   An API key from a supported AI provider (e.g., OpenAI, Anthropic, OpenRouter).

### Installation

Since this is an unpacked extension, you need to load it in developer mode.

1.  Clone this repository or download the source code as a ZIP file and extract it.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable "Developer mode" using the toggle switch in the top-right corner.
4.  Click the "Load unpacked" button.
5.  Select the `ssnnd0-agentssnnd0` directory (the root folder containing `manifest.json`).

### Configuration

1.  After installation, click the extension's icon in the toolbar to open the side panel.
2.  Click the model name badge at the top of the panel to open the **Settings** page in a new tab.
3.  On the **Backend** tab:
    *   Select your desired AI **Provider**.
    *   Enter your **Secret Key** (API key).
    *   Choose a default **Model** from the list.
    *   Click **Test Connection** to verify your setup.
4.  You are now ready to use the extension.

## How to Use

### Accessing the Panel

*   Click the extension icon in the Chrome toolbar.
*   Use the keyboard shortcut: `Ctrl+E` (Windows/Linux) or `Cmd+E` (macOS).

### Chat Mode

Simply type your message in the input box and press `Enter` to chat with the AI. The conversation history is saved locally.

### Agent Mode

1.  Toggle **Agent mode** on using the pill button in the input area. The input prompt will change to reflect you are instructing an agent.
2.  Describe the task you want the agent to perform on the current tab. Be specific.
    *   *Example: "Go to wikipedia.org, search for 'large language models', and extract the first paragraph of the article."*
3.  Press `Enter` to start the agent. You will see a run card appear, showing the agent's progress step-by-step.
4.  The "Ask before acting" setting can be enabled on the Agent settings tab to require manual confirmation before each action.

### Using Commands

Type `/` in the input box to open the command palette. You can filter commands by typing.

*   `/clear`: Clears the current conversation.
*   `/preset <name>`: Loads a saved configuration preset.
*   `/save <name>`: Saves the current configuration (model, temp, etc.) as a new preset.
*   `/skill <name>`: Loads a skill's prompt into the input box.
*   `/provider <name>`: Switches the AI provider.
*   `/model <name>`: Switches the AI model.
*   `/temp <value>`: Sets the temperature for the current session.

## Architecture Overview

*   **`panel.html` / `js/panel.js`**: The frontend of the extension. It handles the UI, user input, and communication with the service worker.
*   **`lib/bootstrap.js`**: The service worker and central orchestrator. It listens for messages, manages agent sessions, and interfaces with the core logic.
*   **`lib/agent.js`**: The main agentic loop. It follows the "Observe -> Think -> Act" cycle, running tasks by interacting with the browser page.
*   **`lib/debugger.js`**: A wrapper around the Chrome DevTools Protocol (CDP). This is used for all browser automation tasks like reading the page state, capturing screenshots, and simulating user input (clicks, typing).
*   **`lib/relay.js`**: A module responsible for formatting and sending requests to the configured AI backend API.
*   **`lib/keeper.js`**: An abstraction layer for `chrome.storage.local` to manage all persistent data like settings, presets, and skills.
*   **`settings.html` / `js/settings.js`**: The configuration page where users manage backends, models, skills, and agent behavior.

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.
