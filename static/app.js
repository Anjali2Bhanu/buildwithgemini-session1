document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const sidebar = document.getElementById("sidebar");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const openSidebarBtn = document.getElementById("openSidebarBtn");
  const closeSidebarBtn = document.getElementById("closeSidebarBtn");
  const newChatBtn = document.getElementById("newChatBtn");
  const historyList = document.getElementById("historyList");
  const modelSelect = document.getElementById("modelSelect");
  const currentModelBadge = document.getElementById("currentModelBadge");
  
  const toggleSearch = document.getElementById("toggleSearch");
  const toggleCode = document.getElementById("toggleCode");
  const chipSearch = document.getElementById("chipSearch");
  const chipCode = document.getElementById("chipCode");
  
  const heroScreen = document.getElementById("heroScreen");
  const messageList = document.getElementById("messageList");
  const chatContainer = document.getElementById("chatContainer");
  const userInput = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");
  const micBtn = document.getElementById("micBtn");
  
  // State
  let currentSessionId = localStorage.getItem("active_session_id") || generateUUID();
  let sessions = JSON.parse(localStorage.getItem("chat_sessions") || "{}");

  // Configure Marked Parser
  if (window.marked) {
    marked.setOptions({
      highlight: function(code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
      },
      breaks: true
    });
  }

  // UUID generator
  function generateUUID() {
    return 'session-' + Math.random().toString(36).substring(2, 9);
  }

  function openSidebar() {
    sidebar.classList.remove("collapsed");
    sidebar.classList.add("open");
    if (sidebarOverlay) sidebarOverlay.classList.add("active");
  }

  function closeSidebar() {
    sidebar.classList.add("collapsed");
    sidebar.classList.remove("open");
    if (sidebarOverlay) sidebarOverlay.classList.remove("active");
  }

  // Initialize UI State
  function init() {
    localStorage.setItem("active_session_id", currentSessionId);
    updateModelBadge();
    renderHistoryList();
    loadSessionMessages();

    // Event Listeners
    if (openSidebarBtn) openSidebarBtn.addEventListener("click", openSidebar);
    if (closeSidebarBtn) closeSidebarBtn.addEventListener("click", closeSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener("click", closeSidebar);
    newChatBtn.addEventListener("click", createNewChat);

    modelSelect.addEventListener("change", () => {
      updateModelBadge();
    });

    toggleSearch.addEventListener("change", () => {
      chipSearch.style.display = toggleSearch.checked ? "inline-flex" : "none";
    });
    toggleCode.addEventListener("change", () => {
      chipCode.style.display = toggleCode.checked ? "inline-flex" : "none";
    });

    userInput.addEventListener("input", autoResizeTextarea);
    userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn.addEventListener("click", sendMessage);
    micBtn.addEventListener("click", simulateMicInput);

    // Prompt Card Clicks
    document.querySelectorAll(".prompt-card").forEach(card => {
      card.addEventListener("click", () => {
        const promptText = card.getAttribute("data-prompt");
        if (promptText) {
          userInput.value = promptText;
          autoResizeTextarea();
          sendMessage();
        }
      });
    });
  }

  function updateModelBadge() {
    const selectedText = modelSelect.options[modelSelect.selectedIndex].text;
    currentModelBadge.textContent = selectedText.replace(/^[^\s]+\s*/, '');
  }

  function autoResizeTextarea() {
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 160) + "px";
  }

  function createNewChat() {
    currentSessionId = generateUUID();
    localStorage.setItem("active_session_id", currentSessionId);
    messageList.innerHTML = "";
    heroScreen.style.display = "flex";
    userInput.value = "";
    autoResizeTextarea();
    renderHistoryList();
    if (window.innerWidth <= 768) closeSidebar();
  }

  function loadSessionMessages() {
    const sessionData = sessions[currentSessionId];
    if (sessionData && sessionData.messages && sessionData.messages.length > 0) {
      heroScreen.style.display = "none";
      messageList.innerHTML = "";
      sessionData.messages.forEach(msg => {
        appendMessageUI(msg.role, msg.text, msg.tools, msg.sources, false);
      });
      scrollToBottom();
    } else {
      heroScreen.style.display = "flex";
      messageList.innerHTML = "";
    }
  }

  function renderHistoryList() {
    historyList.innerHTML = "";
    const sessionKeys = Object.keys(sessions).reverse();

    if (sessionKeys.length === 0) {
      historyList.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:8px;">No chat history yet</div>`;
      return;
    }

    sessionKeys.forEach(id => {
      const sess = sessions[id];
      const item = document.createElement("div");
      item.className = `history-item ${id === currentSessionId ? 'active' : ''}`;
      
      const titleSpan = document.createElement("span");
      titleSpan.className = "history-item-title";
      titleSpan.textContent = sess.title || "New Conversation";
      
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-session-btn";
      deleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i>`;
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteSession(id);
      });

      item.appendChild(titleSpan);
      item.appendChild(deleteBtn);

      item.addEventListener("click", () => {
        currentSessionId = id;
        localStorage.setItem("active_session_id", currentSessionId);
        renderHistoryList();
        loadSessionMessages();
        if (window.innerWidth <= 768) closeSidebar();
      });

      historyList.appendChild(item);
    });
  }

  function deleteSession(id) {
    delete sessions[id];
    localStorage.setItem("chat_sessions", JSON.stringify(sessions));
    if (currentSessionId === id) {
      createNewChat();
    } else {
      renderHistoryList();
    }
  }

  function saveMessageToState(role, text, tools = [], sources = []) {
    if (!sessions[currentSessionId]) {
      sessions[currentSessionId] = {
        title: text.length > 25 ? text.substring(0, 25) + "..." : text,
        messages: []
      };
    }
    sessions[currentSessionId].messages.push({ role, text, tools, sources });
    localStorage.setItem("chat_sessions", JSON.stringify(sessions));
    renderHistoryList();
  }

  async function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    heroScreen.style.display = "none";
    userInput.value = "";
    autoResizeTextarea();

    // User Message UI
    appendMessageUI("user", text);
    saveMessageToState("user", text);

    // Typing Indicator UI
    const typingRow = appendTypingIndicator();
    scrollToBottom();

    // Call Backend API
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          session_id: currentSessionId,
          model: modelSelect.value,
          enable_search: toggleSearch.checked,
          enable_code: toggleCode.checked
        })
      });

      const data = await response.json();
      typingRow.remove();

      if (response.ok) {
        appendMessageUI("assistant", data.text, data.tools_used, data.search_sources);
        saveMessageToState("assistant", data.text, data.tools_used, data.search_sources);
      } else {
        const errorText = data.error || "An error occurred while communicating with Gemini.";
        appendMessageUI("assistant", `⚠️ **Error**: ${errorText}`);
      }
    } catch (err) {
      typingRow.remove();
      appendMessageUI("assistant", `⚠️ **Connection Error**: Failed to reach the backend server.`);
    }

    scrollToBottom();
  }

  function appendMessageUI(role, text, tools = [], sources = [], animate = true) {
    const row = document.createElement("div");
    row.className = `message-row ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.innerHTML = role === "user" 
      ? `<i class="fa-solid fa-user"></i>` 
      : `<i class="fa-solid fa-sparkles"></i>`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    // Render Tools Activity Card if present
    if (tools && tools.length > 0) {
      tools.forEach(tool => {
        if (tool.type === "code_execution") {
          const card = document.createElement("div");
          card.className = "tool-activity-card";
          card.innerHTML = `
            <div class="tool-card-header">
              <span><i class="fa-brands fa-python text-yellow"></i> Executing Python Sandbox</span>
              <span class="active-chip">Python 3.10</span>
            </div>
            <div class="tool-card-content"><code>${escapeHtml(tool.code)}</code></div>
          `;
          bubble.appendChild(card);
        } else if (tool.type === "code_result") {
          const card = document.createElement("div");
          card.className = "tool-activity-card";
          card.innerHTML = `
            <div class="tool-card-header">
              <span><i class="fa-solid fa-terminal text-cyan"></i> Sandbox Output</span>
              <span class="active-chip">${tool.outcome}</span>
            </div>
            <div class="tool-card-content"><code>${escapeHtml(tool.output)}</code></div>
          `;
          bubble.appendChild(card);
        }
      });
    }

    // Render Text Markdown
    const markdownDiv = document.createElement("div");
    markdownDiv.className = "markdown-body";
    markdownDiv.innerHTML = window.marked ? marked.parse(text) : escapeHtml(text);
    bubble.appendChild(markdownDiv);

    // Render Search Source Chips
    if (sources && sources.length > 0) {
      const sourceWrapper = document.createElement("div");
      sourceWrapper.className = "search-sources-wrapper";
      sources.forEach(src => {
        const chip = document.createElement("a");
        chip.className = "source-chip";
        chip.href = src.url;
        chip.target = "_blank";
        chip.innerHTML = `<i class="fa-solid fa-link"></i> ${escapeHtml(src.title)}`;
        sourceWrapper.appendChild(chip);
      });
      bubble.appendChild(sourceWrapper);
    }

    // Add Copy Button to Code Blocks
    bubble.querySelectorAll("pre").forEach(pre => {
      const code = pre.querySelector("code");
      if (code) {
        const header = document.createElement("div");
        header.className = "code-header";
        header.innerHTML = `
          <span>Code Snippet</span>
          <button class="copy-code-btn"><i class="fa-regular fa-copy"></i> Copy</button>
        `;
        const copyBtn = header.querySelector(".copy-code-btn");
        copyBtn.addEventListener("click", () => {
          navigator.clipboard.writeText(code.innerText);
          copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
          setTimeout(() => {
            copyBtn.innerHTML = `<i class="fa-regular fa-copy"></i> Copy`;
          }, 2000);
        });
        pre.parentNode.insertBefore(header, pre);
      }
    });

    row.appendChild(avatar);
    row.appendChild(bubble);
    messageList.appendChild(row);
    
    return row;
  }

  function appendTypingIndicator() {
    const row = document.createElement("div");
    row.className = "message-row assistant";
    row.innerHTML = `
      <div class="msg-avatar"><i class="fa-solid fa-sparkles"></i></div>
      <div class="msg-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    messageList.appendChild(row);
    return row;
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function simulateMicInput() {
    micBtn.style.color = "#ef4444";
    userInput.placeholder = "Listening... (Simulated voice input)";
    setTimeout(() => {
      userInput.placeholder = "Ask anything, execute Python code, or search the web...";
      micBtn.style.color = "var(--text-muted)";
    }, 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  init();
});
