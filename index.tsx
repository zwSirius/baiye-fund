import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { FundProvider } from './contexts/FundContext';
import './index.css'; // Optional: if you have global styles

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