# How the 4 sponsor services work together

> Open this file on **github.com** from your phone — GitHub renders the diagram below automatically.

This is the journey of one request — a marketer pastes their brand's homepage URL and ends up
with a real influencer DM sent and the reply on their phone. Each box is colour-coded by which
sponsor service does the work.

```mermaid
flowchart TD
    M["📱 Marketer"] --> W["🌐 Web App · Next.js<br/>paste homepage URL · 'Find influencers' pill · live chat"]

    W --> RR["RocketRide<br/>the orchestrator / 'manager'<br/>runs discovery.pipe"]

    RR -->|asks the AI| BBAI["Butterbase · AI Gateway<br/>Claude / Gemini"]
    RR -->|reads + writes| XT["XTrace · Memory<br/>brand brief + who we contacted<br/>reconciles contradictions"]
    RR -->|runs tools| T["ingest brand · find creators · score market-movers"]

    T --> BBDB["Butterbase · Database<br/>brand_profile · influencer_candidate · outreach_*"]
    BBDB --> RR

    RR --> R["📋 Ranked influencer shortlist<br/>shown in chat, each with a reason"]
    R --> O["✉️ Marketer approves → Send DM"]
    O --> PH["Photon / Spectrum<br/>+ instagram-private-api"]

    PH -->|sends DM as the brand| IG["💬 Influencer on Instagram"]
    IG -->|replies| PH
    PH -->|relays the reply| IMSG["📱 Marketer's iMessage"]

    XT -. remembers across every turn .-> RR

    classDef rocketride fill:#fb923c,stroke:#c2410c,color:#1a1a1a;
    classDef butterbase fill:#4ade80,stroke:#15803d,color:#1a1a1a;
    classDef xtrace fill:#c084fc,stroke:#7e22ce,color:#1a1a1a;
    classDef photon fill:#60a5fa,stroke:#1d4ed8,color:#1a1a1a;
    classDef app fill:#e5e7eb,stroke:#6b7280,color:#1a1a1a;

    class RR rocketride;
    class BBAI,BBDB butterbase;
    class XT xtrace;
    class PH photon;
    class M,W,T,R,O,IG,IMSG app;
```

## What each service does, in one line

| Service | Colour | Role in the product | Status in our code |
|---|---|---|---|
| **RocketRide** | 🟠 orange | The **manager** of the "find influencers" flow — decides which step/tool/AI call happens next (`discovery.pipe`). | ✅ Real (drives discovery; has a plain-code fallback) |
| **Butterbase** | 🟢 green | The **backend**: the only database (brand + influencer + outreach tables) **and** the only path to the AI models. | ⚠️ Partial — DB ✅ & AI gateway ✅; auth ❌ & storage ❌ unused |
| **XTrace** | 🟣 purple | The **long-term memory** — learns the brand, records who we contacted, recalls it next time, fixes contradictions. | ✅ Real (wired on onboard / discover / outreach) |
| **Photon** | 🔵 blue | The **messaging** layer — sends the real Instagram DM and relays the influencer's reply to the marketer's iMessage. | ✅ Real (needs live credentials to transmit) |

## The story the diagram tells

1. The marketer pastes a homepage URL into the **web app** and taps **"Find influencers."**
2. **RocketRide** takes over as the manager: it talks to the **AI (Butterbase gateway)**, reads/writes
   **memory (XTrace)**, and runs tools that look up the brand and score creators.
3. Everything it learns is saved in the **Butterbase database**; the work streams live into the chat.
4. Out comes a **ranked shortlist** of influencers, each with a one-line reason.
5. The marketer approves → **Photon** sends the **Instagram DM** as the brand.
6. The influencer **replies on Instagram** → **Photon relays it to the marketer's iMessage.**
7. **XTrace** quietly remembers the brand and everyone contacted, so the next run is smarter.
