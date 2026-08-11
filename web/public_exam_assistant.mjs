const messagesElement = document.querySelector("#messages");
const conversationElement = document.querySelector("#conversation");
const formElement = document.querySelector("#assistantForm");
const inputElement = document.querySelector("#assistantInput");
const sendButton = document.querySelector("#sendButton");
const newConversationButton = document.querySelector("#newConversationButton");

const STORAGE_KEY = "easy-exam-public-assistant";
const initialSuggestions = [
  "8-9 的考试试考多少人没参加",
  "查询今天的正考情况",
];

let state = loadState();
let sending = false;

function loadState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
    return {
      context: parsed.context && typeof parsed.context === "object" ? parsed.context : {},
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-40) : [],
    };
  } catch {
    return { context: {}, messages: [] };
  }
}

function saveState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function scrollToLatest() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  });
}

function assistantAvatar() {
  const image = document.createElement("img");
  image.className = "assistant-avatar";
  image.src = "/web/assets/easy-exam-brand-light.png";
  image.alt = "";
  return image;
}

function createMessageElement(role, content, { choices = [], suggestions = [] } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  if (role === "assistant") wrapper.append(assistantAvatar());

  const contentElement = document.createElement("div");
  contentElement.className = "message-content";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = content;
  contentElement.append(bubble);

  if (suggestions.length) {
    const suggestionList = document.createElement("div");
    suggestionList.className = "suggestions";
    suggestions.forEach((suggestion) => {
      const button = document.createElement("button");
      button.className = "suggestion-button";
      button.type = "button";
      button.textContent = suggestion;
      button.addEventListener("click", () => submitQuestion(suggestion));
      suggestionList.append(button);
    });
    contentElement.append(suggestionList);
  }

  if (choices.length) {
    const choiceList = document.createElement("div");
    choiceList.className = "choices";
    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.className = "choice-button";
      button.type = "button";
      button.textContent = `${choice.index}. ${choice.label}`;
      button.addEventListener("click", () => submitQuestion(String(choice.index)));
      choiceList.append(button);
    });
    contentElement.append(choiceList);
  }

  wrapper.append(contentElement);
  return wrapper;
}

function renderConversation() {
  messagesElement.replaceChildren();
  if (!state.messages.length) {
    messagesElement.append(createMessageElement(
      "assistant",
      "你好，今天想查哪场考试？",
      { suggestions: initialSuggestions },
    ));
    return;
  }
  state.messages.forEach((message) => {
    messagesElement.append(createMessageElement(message.role, message.content, { choices: message.choices || [] }));
  });
}

function addMessage(role, content, options = {}) {
  const record = { role, content, choices: options.choices || [] };
  state.messages.push(record);
  state.messages = state.messages.slice(-40);
  saveState();
  messagesElement.append(createMessageElement(role, content, options));
  scrollToLatest();
}

function addTypingIndicator() {
  const wrapper = document.createElement("div");
  wrapper.className = "message assistant";
  wrapper.dataset.typing = "true";
  wrapper.append(assistantAvatar());
  const bubble = document.createElement("div");
  bubble.className = "message-bubble typing-bubble";
  bubble.setAttribute("aria-label", "正在查询");
  for (let index = 0; index < 3; index += 1) bubble.append(document.createElement("span"));
  wrapper.append(bubble);
  messagesElement.append(wrapper);
  scrollToLatest();
}

function removeTypingIndicator() {
  messagesElement.querySelector("[data-typing]")?.remove();
}

function resizeInput() {
  inputElement.style.height = "auto";
  inputElement.style.height = `${Math.min(inputElement.scrollHeight, 144)}px`;
}

async function submitQuestion(question = inputElement.value) {
  const message = String(question || "").trim();
  if (!message || sending) return;
  sending = true;
  sendButton.disabled = true;
  inputElement.value = "";
  resizeInput();
  addMessage("user", message);
  addTypingIndicator();

  try {
    const response = await fetch("/api/public/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, context: state.context }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `查询失败（${response.status}）`);
    state.context = payload.context || {};
    removeTypingIndicator();
    addMessage("assistant", payload.answer || "暂时没有查询到结果。", { choices: payload.choices || [] });
  } catch (error) {
    removeTypingIndicator();
    addMessage("assistant", `查询没有完成：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    sending = false;
    sendButton.disabled = false;
    inputElement.focus();
    saveState();
  }
}

formElement.addEventListener("submit", (event) => {
  event.preventDefault();
  submitQuestion();
});

inputElement.addEventListener("input", resizeInput);
inputElement.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submitQuestion();
});

newConversationButton.addEventListener("click", () => {
  state = { context: {}, messages: [] };
  saveState();
  renderConversation();
  inputElement.focus();
  window.scrollTo({ top: 0 });
});

renderConversation();
resizeInput();
inputElement.focus();
