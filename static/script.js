document.addEventListener("DOMContentLoaded", () => {
    // --- Element Selections ---
    const chatbox = document.getElementById("chatbox");
    const messageInput = document.getElementById("message");
    const sendBtn = document.getElementById("send");
    const typingIndicator = document.getElementById("typing-indicator");
    const conversationList = document.getElementById("conversation-list");
    const newChatBtn = document.getElementById("new-chat-btn");
    const chatHeaderTitle = document.getElementById("chat-header-title");
    
    const loginModal = document.getElementById("login-modal");
    const loginLink = document.getElementById("login-link");
    const closeModalBtn = document.getElementById("close-modal-btn");

    const signupModal = document.getElementById("signup-modal");
    const signupLink = document.getElementById("signup-link");
    const closeSignupModalBtn = document.getElementById("close-signup-modal-btn");

    const subscriptionModal = document.getElementById("subscription-modal");
    const subscriptionLink = document.getElementById("subscription-link");
    const closeSubscriptionModalBtn = document.getElementById("close-subscription-modal-btn");

    const aboutModal = document.getElementById("about-modal");
    const aboutLink = document.getElementById("about-link");
    const closeAboutModalBtn = document.getElementById("close-about-modal-btn");

    const profileModal = document.getElementById("profile-modal");
    const profileLink = document.getElementById("profile-link");
    const closeProfileModalBtn = document.getElementById("close-profile-modal-btn");
    
    const logoutLink = document.getElementById("logout-link");

    const loginForm = document.querySelector("#login-modal form");
    const signupForm = document.querySelector("#signup-modal form");

    let currentConversationId = null;
    let isUserLoggedIn = false;

    // --- Custom Alert Function ---
    function showAlert(message, type = 'success') {
        const alertContainer = document.getElementById('alert-container');
        if (!alertContainer) return;

        const alertId = `alert-${Date.now()}`;
        const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
        
        const alertDiv = document.createElement('div');
        alertDiv.id = alertId;
        alertDiv.className = `p-4 rounded-lg text-white shadow-lg flex items-center justify-between ${bgColor} animate-pulse`;
        alertDiv.innerHTML = `
            <span>${message}</span>
            <button class="ml-4 text-xl font-bold">&times;</button>
        `;
        
        alertContainer.appendChild(alertDiv);

        const timer = setTimeout(() => {
            alertDiv.remove();
        }, 5000);

        alertDiv.querySelector('button').addEventListener('click', () => {
            clearTimeout(timer);
            alertDiv.remove();
        });
    }

    // --- Authentication and UI State ---
    
    async function updateLoginState() {
        try {
            const response = await fetch("/check_session");
            const data = await response.json();
            isUserLoggedIn = data.logged_in;

            const loginLi = document.getElementById("login-link-li");
            const signupLi = document.getElementById("signup-link-li");
            const profileLi = document.getElementById("profile-link-li");
            const logoutLi = document.getElementById("logout-link-li");

            if (isUserLoggedIn) {
                loginLi.style.display = 'none';
                signupLi.style.display = 'none';
                profileLi.style.display = 'block';
                logoutLi.style.display = 'block';
                loadConversations();
            } else {
                loginLi.style.display = 'block';
                signupLi.style.display = 'block';
                profileLi.style.display = 'none';
                logoutLi.style.display = 'none';
                conversationList.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">Please log in to see your chat history.</p>';
                displayWelcomeMessage();
            }
        } catch (error) {
            console.error("Error checking session:", error);
        }
    }

    async function handleSignup(e) {
        e.preventDefault();
        const formData = new FormData(signupForm);
        const data = Object.fromEntries(formData.entries());
        
        try {
            const response = await fetch("/signup", {
                method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)
            });
            const result = await response.json();
            
            if (response.ok && result.success) {
                showAlert(result.message, 'success');
                hideSignupModal();
                updateLoginState();
            } else {
                showAlert(result.message || 'Signup failed. Please try again.', 'error');
            }
        } catch (error) {
            showAlert('A network error occurred. Please try again.', 'error');
        }
    }

    async function handleLogin(e) {
        e.preventDefault();
        const formData = new FormData(loginForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const response = await fetch("/login", {
                method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)
            });
            const result = await response.json();

            if (response.ok && result.success) {
                showAlert(result.message, 'success');
                hideLoginModal();
                updateLoginState(); 
            } else {
                showAlert(result.message || 'Login failed. Please check your credentials.', 'error');
            }
        } catch (error) {
            showAlert('A network error occurred. Please try again.', 'error');
        }
    }

    async function handleLogout(e) {
        e.preventDefault();
        await fetch("/logout", { method: "POST" });
        currentConversationId = null;
        updateLoginState();
        showAlert('You have been logged out.', 'success');
    }

    // --- Modal Control ---
    function showLoginModal() { if (loginModal) loginModal.classList.remove("hidden"); }
    function hideLoginModal() { if (loginModal) loginModal.classList.add("hidden"); }
    
    function showSignupModal() { if (signupModal) signupModal.classList.remove("hidden"); }
    function hideSignupModal() { if (signupModal) signupModal.classList.add("hidden"); }

    function showSubscriptionModal() { if (subscriptionModal) subscriptionModal.classList.remove("hidden"); }
    function hideSubscriptionModal() { if (subscriptionModal) subscriptionModal.classList.add("hidden"); }

    function showAboutModal() { if (aboutModal) aboutModal.classList.remove("hidden"); }
    function hideAboutModal() { if (aboutModal) aboutModal.classList.add("hidden"); }

    function showProfileModal() { if (profileModal) profileModal.classList.remove("hidden"); }
    function hideProfileModal() { if (profileModal) profileModal.classList.add("hidden"); }

    // --- Core Chat Functions ---

    function displayWelcomeMessage() {
        if (!chatHeaderTitle || !chatbox) return;
        chatHeaderTitle.textContent = "Spice AI";
        chatbox.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-center">
                <div class="max-w-3xl">
                    <h2 class="text-3xl font-bold text-gray-800 dark:text-white">Welcome to Spice AI 🌶️</h2>
                    <p class="text-gray-500 dark:text-gray-400 mt-2 mb-8">
                        Your intelligent partner for coding and more. What can I help you with today?
                    </p>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
                        <div class="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                            <h3 class="font-semibold text-gray-800 dark:text-white">Code Generation</h3>
                            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Ask me to write functions, classes, or even entire scripts.</p>
                        </div>
                        <div class="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                            <h3 class="font-semibold text-gray-800 dark:text-white">Bug Fixing</h3>
                            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Paste your broken code and I'll help you find the error.</p>
                        </div>
                        <div class="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                            <h3 class="font-semibold text-gray-800 dark:text-white">Concept Explanation</h3>
                            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Need to understand a concept like APIs or async? Just ask.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async function loadConversations() {
        if (!conversationList) return;
        try {
            const response = await fetch("/get_conversations");
            if (response.status === 401) {
                conversationList.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">Please log in to see your chat history.</p>';
                return;
            }
            if (!response.ok) throw new Error(`Failed to load conversations. Status: ${response.status}`);
            
            const conversations = await response.json();
            
            conversationList.innerHTML = "";
            if (conversations.length === 0) {
                 conversationList.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">No chat history yet.</p>';
            }

            conversations.forEach(conv => {
                const convElement = document.createElement("div");
                convElement.className = "bg-green-100 text-green-800 text-sm font-medium px-2.5 py-1.5 rounded-lg dark:bg-green-900 dark:text-green-300 w-full text-left cursor-pointer hover:opacity-80 truncate";
                convElement.textContent = conv.title;
                convElement.dataset.id = conv.id;
                
                convElement.addEventListener("click", () => {
                    document.querySelectorAll('#conversation-list div').forEach(el => el.classList.remove('ring-2', 'ring-blue-500'));
                    convElement.classList.add('ring-2', 'ring-blue-500');
                    loadMessages(conv.id, conv.title);
                });
                conversationList.appendChild(convElement);
            });
        } catch (error) {
            console.error("Error loading conversations:", error);
            conversationList.innerHTML = '<p class="text-sm text-center text-red-500 p-4">Could not load history.</p>';
        }
    }

    async function loadMessages(conversationId, title) {
        if (!chatbox || !chatHeaderTitle) return;
        currentConversationId = conversationId;
        chatbox.innerHTML = "";
        chatHeaderTitle.textContent = title;
        
        try {
            const response = await fetch(`/get_messages/${conversationId}`);
            if (!response.ok) throw new Error(`Failed to load messages. Status: ${response.status}`);
            const messages = await response.json();
            messages.forEach(msg => appendMessage(msg.role, msg.content));
        } catch (error) {
            console.error("Error loading messages:", error);
            appendMessage("assistant", "Sorry, I couldn't load this conversation.");
        }
    }

    function startNewChat() {
        currentConversationId = null;
        displayWelcomeMessage();
        if (messageInput) {
            messageInput.value = "";
            messageInput.focus();
        }
        document.querySelectorAll('#conversation-list div').forEach(el => el.classList.remove('ring-2', 'ring-blue-500'));
    }

    function appendMessage(sender, text) {
        if (!chatbox) return;
        const senderRole = sender.toLowerCase() === 'user' ? 'user' : 'assistant';
        const justifyClass = senderRole === 'user' ? 'justify-end' : 'justify-start';
        const colorClass = senderRole === 'user' 
            ? 'bg-white dark:bg-gray-600 text-black dark:text-white' 
            : 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white';
        
        const messageWrapper = document.createElement("div");
        messageWrapper.className = `flex ${justifyClass} mb-4`;
        
        const bubble = document.createElement("div");
        bubble.className = `${colorClass} p-3 rounded-lg max-w-lg`;

        const codeRegex = /```(\w*)\n([\s\S]*?)```/g;
        let lastIndex = 0;
        let contentAdded = false;

        text.replace(codeRegex, (match, lang, code, offset) => {
            if (offset > lastIndex) {
                bubble.appendChild(document.createTextNode(text.substring(lastIndex, offset)));
            }
            const pre = document.createElement("pre");
            const codeEl = document.createElement("code");
            codeEl.className = `language-${lang || 'plaintext'}`;
            codeEl.textContent = code.trim();
            if (window.hljs) {
                hljs.highlightElement(codeEl);
            }
            pre.appendChild(codeEl);
            bubble.appendChild(pre);
            lastIndex = offset + match.length;
            contentAdded = true;
        });

        if (lastIndex < text.length) {
            bubble.appendChild(document.createTextNode(text.substring(lastIndex)));
        } else if (!contentAdded) {
            bubble.textContent = text;
        }

        messageWrapper.appendChild(bubble);
        chatbox.appendChild(messageWrapper);
        chatbox.scrollTop = chatbox.scrollHeight;
    }

    function showTypingIndicator(show) {
        if (!typingIndicator || !chatbox) return;
        typingIndicator.classList.toggle("hidden", !show);
        if (show) chatbox.scrollTop = chatbox.scrollHeight;
    }

    async function sendMessage() {
        if (!messageInput) return;
        
        if (!isUserLoggedIn) {
            showLoginModal();
            return;
        }

        const msg = messageInput.value.trim();
        if (!msg) return;

        if (!currentConversationId) {
            chatbox.innerHTML = "";
        }

        appendMessage("user", msg);
        messageInput.value = "";
        messageInput.style.height = 'auto';
        showTypingIndicator(true);

        try {
            const response = await fetch("/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: msg, conversation_id: currentConversationId })
            });

            if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);

            const data = await response.json();
            if (data.error) {
                 appendMessage("assistant", data.reply);
                 return;
            }
            
            appendMessage("assistant", data.reply);

            if (!currentConversationId) {
                currentConversationId = data.conversation_id;
                loadConversations();
            }
        } catch (error) {
            console.error("Error sending message:", error);
            appendMessage("assistant", "Désolé, une erreur est survenue.");
        } finally {
            showTypingIndicator(false);
        }
    }

    // --- Event Listeners ---
    if (loginLink) loginLink.addEventListener("click", (e) => { e.preventDefault(); showLoginModal(); });
    if (closeModalBtn) closeModalBtn.addEventListener("click", hideLoginModal);
    if (loginModal) loginModal.addEventListener("click", (e) => { if (e.target === loginModal) hideLoginModal(); });
    if (loginForm) loginForm.addEventListener("submit", handleLogin);
    
    if (signupLink) signupLink.addEventListener("click", (e) => { e.preventDefault(); showSignupModal(); });
    if (closeSignupModalBtn) closeSignupModalBtn.addEventListener("click", hideSignupModal);
    if (signupModal) signupModal.addEventListener("click", (e) => { if (e.target === signupModal) hideSignupModal(); });
    if (signupForm) signupForm.addEventListener("submit", handleSignup);

    if (subscriptionLink) subscriptionLink.addEventListener("click", (e) => { e.preventDefault(); showSubscriptionModal(); });
    if (closeSubscriptionModalBtn) closeSubscriptionModalBtn.addEventListener("click", hideSubscriptionModal);
    if (subscriptionModal) subscriptionModal.addEventListener("click", (e) => { if (e.target === subscriptionModal) hideSubscriptionModal(); });

    if (aboutLink) aboutLink.addEventListener("click", (e) => { e.preventDefault(); showAboutModal(); });
    if (closeAboutModalBtn) closeAboutModalBtn.addEventListener("click", hideAboutModal);
    if (aboutModal) aboutModal.addEventListener("click", (e) => { if (e.target === aboutModal) hideAboutModal(); });

    if (profileLink) profileLink.addEventListener("click", (e) => { e.preventDefault(); showProfileModal(); });
    if (closeProfileModalBtn) closeProfileModalBtn.addEventListener("click", hideProfileModal);
    if (profileModal) profileModal.addEventListener("click", (e) => { if (e.target === profileModal) hideProfileModal(); });

    if (logoutLink) logoutLink.addEventListener("click", handleLogout);

    if (sendBtn) sendBtn.addEventListener("click", sendMessage);
    if (newChatBtn) newChatBtn.addEventListener("click", startNewChat);

    if (messageInput) {
        messageInput.addEventListener("keypress", e => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = `${messageInput.scrollHeight}px`;
        });
    }

    // --- Initial Load ---
    updateLoginState();
});