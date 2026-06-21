import http from "http";

async function testApi() {
  try {
    const res = await fetch("http://localhost:3000/api/gen-ai-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: null,
        userId: "test_user",
        messages: [{ role: "user", content: "Create a simple to do app" }],
        fileData: null,
      }),
    });
    
    console.log("Status:", res.status);
    if (!res.ok) {
      const text = await res.text();
      console.log("Error body:", text);
      return;
    }
    
    const reader = res.body?.getReader();
    if (!reader) return;
    
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      console.log(decoder.decode(value));
    }
  } catch (err) {
    console.error(err);
  }
}

testApi();
