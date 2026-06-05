import { RocketRideClient, Question } from "rocketride";
async function main() {
  const uri = (process.env.ROCKETRIDE_URI || "localhost:5565").replace(/^(?!\w+:\/\/)/, "http://");
  const appId = process.env.NEXT_PUBLIC_BUTTERBASE_APP_ID!;
  const key = process.env.BUTTERBASE_SERVICE_KEY!;
  const baseURL = `https://api.butterbase.ai/v1/${appId}`;
  console.log("baseURL:", baseURL, "| key starts:", key.slice(0, 6));
  const pipeline = { source: "chat_1", components: [
    { id: "chat_1", provider: "chat", config: { mode: "Source" } },
    { id: "agent", provider: "agent_rocketride", config: { max_waves: 3, instructions: ["Reply with exactly: ROCKETRIDE_OK"] }, input: [{ lane: "questions", from: "chat_1" }] },
    { id: "llm", provider: "llm_openai", config: { model: "anthropic/claude-sonnet-4.6", apikey: key }, control: [{ classType: "llm", from: "agent" }] },
    { id: "mem", provider: "memory_internal", config: {}, control: [{ classType: "memory", from: "agent" }] },
    { id: "out", provider: "response_answers", config: { laneName: "answers" }, input: [{ lane: "answers", from: "agent" }] },
  ] };
  const c = new RocketRideClient({ auth: process.env.ROCKETRIDE_APIKEY!, uri } as any);
  await c.connect(process.env.ROCKETRIDE_APIKEY, { uri } as any);
  const started: any = await c.use({ pipeline } as any);
  const q = new Question(); q.addQuestion("Run the test.");
  const res: any = await c.chat({ token: started.token, question: q } as any);
  console.log("RESULT:", JSON.stringify(res?.answers ?? res).slice(0, 400));
  try { await c.terminate(started.token); await c.disconnect(); } catch {}
}
main().catch((e: any) => console.error("ERR:", e?.message, JSON.stringify(e ?? {}).slice(0, 200)));
