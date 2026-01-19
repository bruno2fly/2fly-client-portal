import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ContentLibrary } from "./pages/ContentLibrary";
import "../lib/tokens.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/content" element={<ContentLibrary />} />
        <Route path="/" element={<div className="p-8 text-center">
          <h1 className="text-2xl mb-4">2Fly Client Portal</h1>
          <a href="/content" className="text-[var(--accent)] hover:underline">
            Go to Content Library
          </a>
        </div>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

