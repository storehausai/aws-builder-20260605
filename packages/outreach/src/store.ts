/**
 * Tiny file-backed store for Milestone A — captures inbound DMs so the send-test
 * script can reply to the most recent sender's IGSID. In the real product this is
 * the Butterbase `outreach_thread` / `outreach_message` tables; here it's a local
 * JSON file so we can prove the round-trip with zero backend.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { IgInboundMessage } from "./instagram/types.js";

export interface CapturedThread {
  senderId: string;
  lastText: string;
  lastAt: number;
  count: number;
}

interface StoreShape {
  lastSenderId: string | null;
  threads: Record<string, CapturedThread>;
  inbox: IgInboundMessage[];
}

const empty: StoreShape = { lastSenderId: null, threads: {}, inbox: [] };

export class InboundStore {
  constructor(private readonly path: string) {}

  private read(): StoreShape {
    if (!existsSync(this.path)) return { ...empty };
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as StoreShape;
    } catch {
      return { ...empty };
    }
  }

  private write(s: StoreShape): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(s, null, 2));
  }

  record(msg: IgInboundMessage): void {
    const s = this.read();
    s.lastSenderId = msg.senderId;
    const t = s.threads[msg.senderId] ?? { senderId: msg.senderId, lastText: "", lastAt: 0, count: 0 };
    t.lastText = msg.text;
    t.lastAt = msg.timestamp;
    t.count += 1;
    s.threads[msg.senderId] = t;
    s.inbox.push(msg);
    this.write(s);
  }

  lastSenderId(): string | null {
    return this.read().lastSenderId;
  }

  snapshot(): StoreShape {
    return this.read();
  }
}
