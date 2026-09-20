# AgentSSNND0

AgentSSNND0 is a Chrome extension for AI-assisted page understanding and browser action selection. It focuses on reading the current webpage, ranking likely next actions, and optionally executing them in-browser to support research-style browsing, page testing, and agentic workflows.

## What it does

- Reads the active page and extracts visible page context
- Scores interactive elements by relevance to the user task
- Uses a simple JEV-style decision loop to select the best next action
- Executes real browser actions such as clicks, typing, selection, scrolling, and navigation
- Supports inspect and cursor-follow modes for live page analysis

## Current architecture

- `src/ai-jev-architecture.ts`: page summarization, candidate scoring, interaction kind detection, and selection logic
- `src/content.ts`: DOM extraction and browser-side execution of selected actions
- `src/background.ts`: runtime message routing and orchestration between panel and content script
- `src/sidepanel.ts`: side-panel UI for reading the page and reviewing ranked actions
- `src/settings-app.ts`: local configuration for provider/model/API key storage
- `vite.config.ts`: TypeScript + Vite build pipeline for extension bundles

## Build and test

```bash
npm install
npm run build
npm test
```

## Loading the extension

For production use, load the generated `dist` folder in Chrome after building:

1. Run `npm run build`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Choose `Load unpacked`
5. Select the `dist` directory

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.
