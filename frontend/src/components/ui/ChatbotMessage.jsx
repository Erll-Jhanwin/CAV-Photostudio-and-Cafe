import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';

export const CHATBOT_FAQ_PROMPTS = [
  'What are your operating hours?',
  'How do I book a studio session?',
  'What packages do you offer?',
  'Can we walk in for cafe or photo studio?',
  'Where is CAV located?',
  'Available ba ang Solo Package bukas?',
];

export function ChatbotMessageContent({ content }) {
  const lines = String(content || '').split('\n');
  const blocks = [];
  let bullets = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="space-y-1 pl-4 list-disc">
        {bullets.map((line, index) => (
          <li key={`${line}-${index}`} className="pl-1">
            {line.replace(/^-\s*/, '')}
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushBullets();
      return;
    }
    if (trimmed.startsWith('- ')) {
      bullets.push(trimmed);
      return;
    }
    flushBullets();
    blocks.push(
      <p key={`p-${index}`} className="whitespace-pre-wrap break-words">
        {trimmed}
      </p>
    );
  });
  flushBullets();

  return <div className="space-y-2">{blocks}</div>;
}

export function ChatbotFaqPrompts({
  onSelect,
  disabled = false,
  prompts = CHATBOT_FAQ_PROMPTS,
  shouldMinimize = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const previousShouldMinimize = useRef(false);

  useEffect(() => {
    if (shouldMinimize && !previousShouldMinimize.current) {
      setExpanded(false);
      setMinimized(true);
    }
    previousShouldMinimize.current = shouldMinimize;
  }, [shouldMinimize]);

  const handleSelect = (prompt) => {
    setExpanded(false);
    setMinimized(true);
    onSelect(prompt);
  };

  if (minimized) {
    return (
      <div className="flex justify-center py-1 animate-in">
        <button
          type="button"
          onClick={() => {
            setMinimized(false);
            setExpanded(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-espresso/10 bg-white/90 px-3 py-1.5 text-[11px] font-bold text-espresso/65 shadow-sm transition-all duration-300 hover:bg-cream hover:text-espresso hover:shadow-md"
        >
          <HelpCircle className="w-3.5 h-3.5 text-gold" />
          Show Quick Questions
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white/80 border border-espresso/5 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors duration-300 hover:bg-cream/70"
        aria-expanded={expanded}
      >
        <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-espresso/55">
          <HelpCircle className="w-3.5 h-3.5 text-gold" />
          Quick Questions
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-espresso/45" />
        ) : (
          <ChevronDown className="w-4 h-4 text-espresso/45" />
        )}
      </button>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0 flex flex-wrap gap-2">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={disabled}
                onClick={() => handleSelect(prompt)}
                className="rounded-full border border-espresso/10 bg-cream px-3 py-1.5 text-[11px] font-bold text-espresso/70 transition-all duration-300 hover:bg-gold hover:text-espresso disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
