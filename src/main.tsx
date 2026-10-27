import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { EvidenceProvider } from './context/EvidenceContext';
import ServerWakeNotice from './components/layout/ServerWakeNotice';
import { api } from './services/api';
import { startDiagnostics } from './services/diagnostics';
import './index.css';

if (import.meta.env.DEV) void startDiagnostics();
if (api.useBackend('auth')) api.warmUp();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><AuthProvider><EvidenceProvider><App /></EvidenceProvider><ServerWakeNotice /></AuthProvider></BrowserRouter></React.StrictMode>);
