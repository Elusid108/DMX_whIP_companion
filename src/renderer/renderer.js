const { createRoot } = require('react-dom/client');
const React = require('react');
const { ipcRenderer } = require('electron');
const App = require('./App');

document.addEventListener('DOMContentLoaded', () => {
    // Initialize error handling
    window.onerror = (message, source, lineno, colno, error) => {
        console.error('Window Error:', {
            message,
            source,
            lineno,
            colno,
            error: error?.stack
        });
    };

    window.onunhandledrejection = (event) => {
        console.error('Unhandled Promise Rejection:', event.reason);
    };

    // Add IPC error logging
    ipcRenderer.on('error', (event, error) => {
        console.error('IPC Error:', error);
    });

    // Create and render the root component
    const container = document.getElementById('root');
    if (!container) {
        throw new Error('Root element not found!');
    }

    const root = createRoot(container);
    root.render(React.createElement(
        React.StrictMode,
        null,
        React.createElement(App)
    ));
});