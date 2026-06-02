import { useEffect, useState } from 'react';

declare global {
  interface Window {
    voiceflow: {
      listHistory: () => Promise<any[]>;
      removeHistory: (id: number) => Promise<any[]>;
      clearHistory: () => Promise<any[]>;
      injectHistory: (id: number) => Promise<any>;
      [k: string]: any;
    };
  }
}

interface HistoryItem {
  id: number;
  text: string;
  polishedText: string | null;
  usedAi: boolean;
  createdAt: number;
}

export function HistoryPanel() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const list = await window.voiceflow.listHistory();
    setItems(list);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleDelete = async (id: number) => {
    const list = await window.voiceflow.removeHistory(id);
    setItems(list);
  };

  const handleClear = async () => {
    if (!confirm('确定清空所有历史记录？此操作不可恢复。')) return;
    const list = await window.voiceflow.clearHistory();
    setItems(list);
  };

  const handleInject = async (id: number) => {
    const result = await window.voiceflow.injectHistory(id);
    if (result?.ok) {
      // 给个简单反馈
      const el = document.getElementById(`inject-feedback-${id}`);
      if (el) {
        el.textContent = '✓ 已注入';
        el.classList.add('text-success-500');
        setTimeout(() => {
          if (el) {
            el.textContent = '';
            el.classList.remove('text-success-500');
          }
        }, 2000);
      }
    } else {
      alert(result?.message || '注入失败');
    }
  };

  return (
    <div className="w-full h-full bg-bg-base overflow-y-auto">
      <div className="max-w-3xl mx-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">历史记录</h1>
            <p className="text-sm text-ink-500 mt-1">
              最近 {items.length} / 30 条 · 点击"注入"可填到当前输入框
            </p>
          </div>
          <button
            onClick={handleClear}
            disabled={items.length === 0}
            className="text-xs px-3 py-1.5 text-danger-500 hover:bg-danger-50 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            清空全部
          </button>
        </div>

        {loading ? (
          <div className="text-center text-ink-500 py-12">加载中…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4 opacity-30">🎙</div>
            <div className="text-ink-500">还没有历史记录</div>
            <div className="text-xs text-ink-300 mt-1">使用快捷键说话后会出现在这里</div>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-white/70 backdrop-blur-xl rounded-2xl p-4 shadow-glass-sm border border-white/60"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="text-[11px] text-ink-500">
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                    {item.usedAi && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-accent-500/15 text-accent-500 rounded">
                        AI
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleInject(item.id)}
                      className="text-[11px] px-2.5 py-1 text-primary-500 hover:bg-primary-50 rounded transition"
                    >
                      注入
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(item.polishedText || item.text)}
                      className="text-[11px] px-2.5 py-1 text-ink-700 hover:bg-white/60 rounded transition"
                    >
                      复制
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-[11px] px-2.5 py-1 text-danger-500 hover:bg-danger-50 rounded transition"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div id={`inject-feedback-${item.id}`} className="text-[10px] text-right mb-1 h-3" />
                {item.polishedText && (
                  <div className="mb-2">
                    <div className="text-[10px] text-ink-500 mb-1">原文</div>
                    <div className="text-[12px] text-ink-500 leading-relaxed line-through opacity-70">
                      {item.text}
                    </div>
                  </div>
                )}
                <div className="text-[12px] text-ink-900 leading-relaxed">
                  {item.polishedText || item.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
