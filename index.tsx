import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './src/App';
import { FundProvider } from './src/contexts/FundContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <FundProvider>
        <App />
    </FundProvider>
  </React.StrictMode>
);