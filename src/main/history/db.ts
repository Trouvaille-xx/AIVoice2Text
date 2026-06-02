/**
 * 历史记录 (SQLite)
 * - 固定保留最近 30 条
 * - FIFO
 */
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';
import type { HistoryItem } from '@shared/types';

const MAX_ITEMS = 30;

export class HistoryDB {
  private db: Database.Database;

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'history.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        polished_text TEXT,
        used_ai INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);
    `);
  }

  add(item: Omit<HistoryItem, 'id' | 'createdAt'>): number {
    const stmt = this.db.prepare(
      `INSERT INTO history (text, polished_text, used_ai, created_at) VALUES (?, ?, ?, ?)`
    );
    const id = Number(
      stmt.run(
        item.text,
        item.polishedText,
        item.usedAi ? 1 : 0,
        Date.now()
      ).lastInsertRowid
    );
    // 清理超出 30 条的
    this.cleanup();
    return id;
  }

  private cleanup() {
    this.db.exec(`
      DELETE FROM history
      WHERE id NOT IN (
        SELECT id FROM history ORDER BY created_at DESC LIMIT ${MAX_ITEMS}
      )
    `);
  }

  list(limit = MAX_ITEMS): HistoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, text, polished_text, used_ai, created_at FROM history ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as Array<{
      id: number;
      text: string;
      polished_text: string | null;
      used_ai: number;
      created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      polishedText: r.polished_text,
      usedAi: r.used_ai === 1,
      createdAt: r.created_at,
    }));
  }

  remove(id: number) {
    this.db.prepare(`DELETE FROM history WHERE id = ?`).run(id);
  }

  clear() {
    this.db.prepare(`DELETE FROM history`).run();
  }

  close() {
    try {
      this.db.close();
    } catch (e) {
      log.warn('[history] close error', e);
    }
  }
}
