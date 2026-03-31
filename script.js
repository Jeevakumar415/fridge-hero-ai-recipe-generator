function getGroqApiKey() {
  if (typeof window !== "undefined" && window.FRIDGE_HERO_GROQ_API_KEY) {
    const k = String(window.FRIDGE_HERO_GROQ_API_KEY).trim();
    if (k && k !== "YOUR_API_KEY_HERE") return k;
  }
  return "";
}

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

function buildChefPrompt(ingredient1, ingredient2, ingredient3) {
  return (
    "You are a creative chef. Given these 3 ingredients: " +
    `${ingredient1}, ${ingredient2}, ${ingredient3}, produce a recipe as JSON only.\n\n` +
    "Required fields:\n" +
    '- "dishName": a fancy French-inspired dish name (one line).\n' +
    '- "steps": an array of at least 5 strings (5–12 is ideal). Each string is ONE step written as 2–4 full sentences.\n' +
    "  Never return fewer than 5 steps.\n\n" +
    "For each step, elaborate clearly:\n" +
    "- What to do, in order, with the ingredients and any reasonable pantry items (oil, salt, pepper, butter, etc.).\n" +
    "- Approximate times (e.g. \"simmer 8–10 minutes\") and heat levels (medium, gentle boil) where useful.\n" +
    "- Visual or texture cues (golden edges, tender when pierced, sauce coats the back of a spoon).\n" +
    "- Food safety when relevant (cook poultry through, rest meat briefly).\n\n" +
    "Cover the full flow across steps: mise en place and prep → main cooking → seasoning and balance → finishing → " +
    "plating or serving suggestion. Start each step string with a short bold-style label in plain text, e.g. " +
    '"Step 1 — Prepare the ingredients: ..."\n\n' +
    'Return only valid JSON: {"dishName": string, "steps": string[]}. No markdown fences or extra keys.'
  );
}

function extractGroqMessageText(data) {
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("No message content from Groq.");
  }
  return text.trim();
}

/** Strips optional ```json fences and parses model output. */
function parseChefJson(text) {
  let raw = text.trim();
  if (raw.includes("```")) {
    const open = raw.indexOf("```");
    const afterOpen = raw.indexOf("\n", open);
    const innerStart = afterOpen === -1 ? open + 3 : afterOpen + 1;
    const close = raw.lastIndexOf("```");
    if (close > open) raw = raw.slice(innerStart, close).replace(/^(json)\s*/i, "").trim();
  }
  const obj = JSON.parse(raw);
  if (typeof obj?.dishName !== "string" || !Array.isArray(obj?.steps)) {
    throw new Error("Response JSON must include dishName (string) and steps (array).");
  }
  const steps = obj.steps.map((s) => String(s).trim()).filter(Boolean);
  const minSteps = 5;
  const maxSteps = 16;
  if (steps.length < minSteps || steps.length > maxSteps) {
    throw new Error(`Expected at least ${minSteps} detailed steps (max ${maxSteps}), got ${steps.length}.`);
  }
  return { dishName: String(obj.dishName).trim(), steps };
}

function renderResultCard(resultBody, { dishName, steps }) {
  resultBody.replaceChildren();

  const dish = document.createElement("h3");
  dish.className = "result-dish";
  dish.textContent = dishName;

  const list = document.createElement("ol");
  list.className = "result-steps";
  for (const step of steps) {
    const li = document.createElement("li");
    li.textContent = step;
    list.appendChild(li);
  }

  resultBody.appendChild(dish);
  resultBody.appendChild(list);
}

function playResultAnimation(resultBody) {
  resultBody.classList.remove("result-card__body--enter");
  void resultBody.offsetWidth;
  resultBody.classList.add("result-card__body--enter");
}

function showErrorState(resultCard, resultBody, message) {
  resultCard.hidden = false;
  resultCard.classList.add("is-error");
  resultBody.classList.add("is-error");
  resultBody.replaceChildren();
  const p = document.createElement("p");
  p.className = "result-error";
  p.textContent = message;
  resultBody.appendChild(p);
  playResultAnimation(resultBody);
}

async function callGroqChef(apiKey, ingredient1, ingredient2, ingredient3) {
  const body = {
    model: GROQ_MODEL,
    messages: [{ role: "user", content: buildChefPrompt(ingredient1, ingredient2, ingredient3) }],
    temperature: 0.6,
    response_format: { type: "json_object" },
  };

  let response;
  try {
    response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    const msg = netErr instanceof Error ? netErr.message : String(netErr);
    throw new Error(`Network error: ${msg}`);
  }

  const raw = await response.text();

  if (!response.ok) {
    let short = raw || response.statusText;
    try {
      const errJson = JSON.parse(raw);
      const m = errJson?.error?.message;
      if (m) short = `${response.status}: ${m}`;
    } catch {
      /* keep raw */
    }
    throw new Error(`Groq API ${response.status}: ${short}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Groq returned invalid JSON.");
  }

  const text = extractGroqMessageText(data);
  return parseChefJson(text);
}

function readIngredients() {
  return {
    i1: document.getElementById("ingredient-1").value.trim(),
    i2: document.getElementById("ingredient-2").value.trim(),
    i3: document.getElementById("ingredient-3").value.trim(),
  };
}

function validateAllFilled(i1, i2, i3) {
  const missing = [];
  if (!i1) missing.push("Ingredient 1");
  if (!i2) missing.push("Ingredient 2");
  if (!i3) missing.push("Ingredient 3");
  return missing;
}

function initFridgeHero() {
  const form = document.getElementById("fridge-form");
  const submitBtn = form.querySelector('button[type="submit"]');
  const defaultSubmitLabel = submitBtn.textContent.trim();
  const resultCard = document.getElementById("result-card");
  const resultBody = document.getElementById("result-body");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const { i1, i2, i3 } = readIngredients();
    const missing = validateAllFilled(i1, i2, i3);

    if (missing.length > 0) {
      resultCard.hidden = false;
      resultCard.classList.add("is-error");
      resultBody.classList.add("is-error");
      resultBody.replaceChildren();
      const p = document.createElement("p");
      p.className = "result-error";
      p.textContent = `Please fill in: ${missing.join(", ")}.`;
      resultBody.appendChild(p);
      playResultAnimation(resultBody);
      return;
    }

    const apiKey = getGroqApiKey();
    if (!apiKey) {
      showErrorState(
        resultCard,
        resultBody,
        "Missing API key. Set window.FRIDGE_HERO_GROQ_API_KEY in config.js (see config.example.js).",
      );
      return;
    }

    resultCard.hidden = false;
    resultCard.classList.remove("is-error");
    resultBody.classList.remove("is-error");
    resultBody.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "result-loading";
    loading.textContent = "Consulting the chef…";
    resultBody.appendChild(loading);
    playResultAnimation(resultBody);

    submitBtn.disabled = true;
    submitBtn.textContent = "Loading";

    try {
      const recipe = await callGroqChef(apiKey, i1, i2, i3);
      resultCard.classList.remove("is-error");
      resultBody.classList.remove("is-error");
      renderResultCard(resultBody, recipe);
      playResultAnimation(resultBody);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      let userMsg = message;
      if (message.includes("JSON.parse") || message.includes("JSON")) {
        userMsg = "Could not read the recipe JSON from the model. Try again.";
      }
      showErrorState(resultCard, resultBody, userMsg);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = defaultSubmitLabel;
    }
  });
}

initFridgeHero();
