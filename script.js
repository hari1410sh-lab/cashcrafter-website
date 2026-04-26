/* ==========================================================================
   CashCrafter — Main JavaScript
   Pure vanilla JS. Beginner-friendly, fully commented.
   ==========================================================================
   What this file does:
   - Handles mobile nav toggle and smooth scrolling
   - Reveals elements on scroll (IntersectionObserver)
   - Provides a client-side login system (signup, login, logout)
       * Passwords are hashed with SHA-256 via the browser's SubtleCrypto API
       * Accounts and the active session are stored in localStorage
   - Each logged-in user has their own private budget storage key,
     so multiple people can share a browser without seeing each other's data
   - Manages income/expense entries with localStorage persistence
   - Calculates totals, balance, savings rate, and a status banner
   - Renders a Chart.js pie chart of expenses by category
   - Powers three financial tools (savings, profit margin, loan)
   - Validates all inputs (no empty values, no negative numbers)
   - Handles the contact form
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- Constants ---------- */
  // Per-user budget data is stored under: cashcrafter_data_v1::<email>
  var BUDGET_KEY_PREFIX = "cashcrafter_data_v1::";

  // Auth-related localStorage keys
  var USERS_KEY = "cashcrafter_users_v1";       // array of accounts
  var SESSION_KEY = "cashcrafter_session_v1";   // currently signed-in email

  // Color palette used by the pie chart, cycles for many categories.
  var CHART_PALETTE = [
    "#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
    "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6",
  ];

  /* ---------- Application state ---------- */
  // The currently signed-in user object, or null when logged out.
  var currentUser = null;

  // Budget state: the source of truth for the *current* user's data.
  // Reset to an empty shape whenever no one is logged in.
  var state = { incomes: [], expenses: [] };

  // The Chart.js instance is created once, then updated in place.
  var expenseChart = null;

  /* ---------- Cached DOM references ---------- */
  var dom = {};

  /* =========================================================================
     INITIALIZATION
     ========================================================================= */
  document.addEventListener("DOMContentLoaded", function () {
    cacheDom();
    setCurrentYear();
    setupMobileNav();
    setupSmoothScroll();
    setupScrollReveal();

    setupAuth();

    setupBudgetCalculator();
    setupResetButton();

    setupSavingsTool();
    setupProfitMarginTool();
    setupLoanTool();

    setupContactForm();

    // Restore the previous session (if any) and render everything
    restoreSession();
  });

  // Cache every element we need exactly once.
  function cacheDom() {
    dom = {
      year: document.getElementById("year"),

      // Navigation
      menuToggle: document.getElementById("menuToggle"),
      navLinks: document.getElementById("navLinks"),

      // Auth — nav buttons / chip
      openLoginBtn: document.getElementById("openLoginBtn"),
      logoutBtn: document.getElementById("logoutBtn"),
      userChip: document.getElementById("userChip"),
      userChipName: document.getElementById("userChipName"),
      userChipAvatar: document.getElementById("userChipAvatar"),

      // Auth modal
      authModal: document.getElementById("authModal"),
      authBackdrop: document.getElementById("authBackdrop"),
      authCloseBtn: document.getElementById("authCloseBtn"),
      loginTabBtn: document.getElementById("loginTabBtn"),
      signupTabBtn: document.getElementById("signupTabBtn"),

      // Login form
      loginForm: document.getElementById("loginForm"),
      loginEmail: document.getElementById("loginEmail"),
      loginPassword: document.getElementById("loginPassword"),
      loginError: document.getElementById("loginError"),

      // Signup form
      signupForm: document.getElementById("signupForm"),
      signupName: document.getElementById("signupName"),
      signupEmail: document.getElementById("signupEmail"),
      signupPassword: document.getElementById("signupPassword"),
      signupConfirm: document.getElementById("signupConfirm"),
      signupError: document.getElementById("signupError"),

      // Login gate (shown when calculator is locked)
      loginGate: document.getElementById("loginGate"),
      gateLoginBtn: document.getElementById("gateLoginBtn"),
      calculatorGrid: document.getElementById("calculatorGrid"),

      // Income/expense forms
      incomeForm: document.getElementById("incomeForm"),
      incomeName: document.getElementById("incomeName"),
      incomeAmount: document.getElementById("incomeAmount"),
      incomeError: document.getElementById("incomeError"),

      expenseForm: document.getElementById("expenseForm"),
      expenseName: document.getElementById("expenseName"),
      expenseAmount: document.getElementById("expenseAmount"),
      expenseError: document.getElementById("expenseError"),

      resetBtn: document.getElementById("resetBtn"),

      // Summary
      totalIncome: document.getElementById("totalIncome"),
      totalExpense: document.getElementById("totalExpense"),
      balance: document.getElementById("balance"),
      statusBanner: document.getElementById("statusBanner"),

      // Lists
      incomeList: document.getElementById("incomeList"),
      incomeEmpty: document.getElementById("incomeEmpty"),
      expenseList: document.getElementById("expenseList"),
      expenseEmpty: document.getElementById("expenseEmpty"),

      // Chart
      expenseChartCanvas: document.getElementById("expenseChart"),
      chartEmpty: document.getElementById("chartEmpty"),

      // Tools — savings goal
      goalAmount: document.getElementById("goalAmount"),
      goalMonths: document.getElementById("goalMonths"),
      calcGoalBtn: document.getElementById("calcGoalBtn"),
      goalResult: document.getElementById("goalResult"),

      // Tools — profit margin
      revenueInput: document.getElementById("revenueInput"),
      costInput: document.getElementById("costInput"),
      calcMarginBtn: document.getElementById("calcMarginBtn"),
      marginResult: document.getElementById("marginResult"),

      // Tools — loan estimator
      loanAmount: document.getElementById("loanAmount"),
      loanRate: document.getElementById("loanRate"),
      loanYears: document.getElementById("loanYears"),
      calcLoanBtn: document.getElementById("calcLoanBtn"),
      loanResult: document.getElementById("loanResult"),

      // Contact
      contactForm: document.getElementById("contactForm"),
      contactName: document.getElementById("contactName"),
      contactEmail: document.getElementById("contactEmail"),
      contactMessage: document.getElementById("contactMessage"),
      contactError: document.getElementById("contactError"),
      contactSuccess: document.getElementById("contactSuccess"),
    };
  }

  /* =========================================================================
     UTILITIES
     ========================================================================= */
  function formatCurrency(value) {
    var n = Number(value) || 0;
    return n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function setCurrentYear() {
    if (dom.year) dom.year.textContent = String(new Date().getFullYear());
  }

  function sumAmounts(list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      total += Number(list[i].amount) || 0;
    }
    return total;
  }

  function flash(el) {
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth; // force reflow so the animation can replay
    el.classList.add("flash");
  }

  /* ---------- Validation helpers ---------- */
  function validateName(value) {
    var trimmed = String(value || "").trim();
    if (!trimmed) return "Please enter a name.";
    if (trimmed.length > 40) return "Name is too long (max 40 characters).";
    return null;
  }

  function validateAmount(value) {
    if (value === "" || value === null || value === undefined) {
      return "Please enter an amount.";
    }
    var n = Number(value);
    if (isNaN(n)) return "Amount must be a number.";
    if (n < 0) return "Amount cannot be negative.";
    if (n === 0) return "Amount must be greater than 0.";
    return null;
  }

  function markInvalid(input, isInvalid) {
    if (!input) return;
    if (isInvalid) input.classList.add("input-error");
    else input.classList.remove("input-error");
  }

  /* =========================================================================
     PER-USER BUDGET STORAGE
     ========================================================================= */
  // Build the localStorage key for a given user's budget data.
  function budgetKeyFor(email) {
    return BUDGET_KEY_PREFIX + String(email || "").toLowerCase();
  }

  function loadBudgetFor(email) {
    if (!email) return { incomes: [], expenses: [] };
    try {
      var raw = localStorage.getItem(budgetKeyFor(email));
      if (!raw) return { incomes: [], expenses: [] };
      var parsed = JSON.parse(raw);
      return {
        incomes: Array.isArray(parsed.incomes) ? parsed.incomes : [],
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      };
    } catch (err) {
      return { incomes: [], expenses: [] };
    }
  }

  function saveBudget() {
    if (!currentUser) return; // never write budget data without a session
    try {
      localStorage.setItem(
        budgetKeyFor(currentUser.email),
        JSON.stringify(state)
      );
    } catch (err) {
      // localStorage may be disabled (private mode) — fail silently
    }
  }

  // Single entry point for every budget mutation.
  function updateState(mutator) {
    if (!currentUser) return; // ignore writes when logged out
    mutator(state);
    saveBudget();
    renderAll();
  }

  /* =========================================================================
     AUTH — accounts, sessions, hashing
     ========================================================================= */

  // Hash a password with SHA-256 (returns a hex string).
  // Note: client-side hashing is not as strong as server-side hashing with
  // bcrypt/argon2, but for a localStorage-only app it's a reasonable choice
  // and far better than storing plain text.
  function hashPassword(password) {
    var enc = new TextEncoder();
    var data = enc.encode(password);

    if (window.crypto && window.crypto.subtle) {
      return window.crypto.subtle.digest("SHA-256", data).then(function (buf) {
        var bytes = new Uint8Array(buf);
        var hex = "";
        for (var i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, "0");
        }
        return hex;
      });
    }
    // Fallback: very weak, only used if SubtleCrypto is missing.
    var sum = 0;
    for (var j = 0; j < password.length; j++) {
      sum = (sum * 31 + password.charCodeAt(j)) >>> 0;
    }
    return Promise.resolve("fallback:" + sum.toString(16));
  }

  function loadUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function saveUsers(users) {
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    } catch (err) {}
  }

  function findUser(email) {
    var users = loadUsers();
    var lower = String(email || "").toLowerCase();
    for (var i = 0; i < users.length; i++) {
      if (users[i].email === lower) return users[i];
    }
    return null;
  }

  function setSession(email) {
    try {
      localStorage.setItem(SESSION_KEY, String(email || "").toLowerCase());
    } catch (err) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (err) {}
  }

  function getSession() {
    try {
      return localStorage.getItem(SESSION_KEY) || null;
    } catch (err) {
      return null;
    }
  }

  // Wire up every auth-related interaction.
  function setupAuth() {
    if (dom.openLoginBtn) {
      dom.openLoginBtn.addEventListener("click", function () {
        openAuthModal("login");
      });
    }
    if (dom.gateLoginBtn) {
      dom.gateLoginBtn.addEventListener("click", function () {
        openAuthModal("signup"); // first-time visitors usually need an account
      });
    }
    if (dom.logoutBtn) {
      dom.logoutBtn.addEventListener("click", logout);
    }
    if (dom.authCloseBtn) {
      dom.authCloseBtn.addEventListener("click", closeAuthModal);
    }
    if (dom.authBackdrop) {
      dom.authBackdrop.addEventListener("click", closeAuthModal);
    }
    if (dom.loginTabBtn) {
      dom.loginTabBtn.addEventListener("click", function () {
        switchAuthTab("login");
      });
    }
    if (dom.signupTabBtn) {
      dom.signupTabBtn.addEventListener("click", function () {
        switchAuthTab("signup");
      });
    }

    // Close modal with Escape
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && dom.authModal && !dom.authModal.hidden) {
        closeAuthModal();
      }
    });

    if (dom.loginForm) {
      dom.loginForm.addEventListener("submit", function (e) {
        e.preventDefault();
        handleLogin();
      });
    }
    if (dom.signupForm) {
      dom.signupForm.addEventListener("submit", function (e) {
        e.preventDefault();
        handleSignup();
      });
    }
  }

  function openAuthModal(initialTab) {
    if (!dom.authModal) return;
    dom.authModal.hidden = false;
    switchAuthTab(initialTab || "login");

    // Focus the first relevant input for keyboard users
    setTimeout(function () {
      var firstInput =
        initialTab === "signup"
          ? dom.signupName
          : dom.loginEmail;
      if (firstInput) firstInput.focus();
    }, 50);
  }

  function closeAuthModal() {
    if (!dom.authModal) return;
    dom.authModal.hidden = true;

    // Reset error messages and inputs
    if (dom.loginError) dom.loginError.textContent = "";
    if (dom.signupError) dom.signupError.textContent = "";
    if (dom.loginForm) dom.loginForm.reset();
    if (dom.signupForm) dom.signupForm.reset();
  }

  function switchAuthTab(tab) {
    var isLogin = tab === "login";

    if (dom.loginTabBtn) {
      dom.loginTabBtn.classList.toggle("is-active", isLogin);
      dom.loginTabBtn.setAttribute("aria-selected", isLogin ? "true" : "false");
    }
    if (dom.signupTabBtn) {
      dom.signupTabBtn.classList.toggle("is-active", !isLogin);
      dom.signupTabBtn.setAttribute(
        "aria-selected",
        !isLogin ? "true" : "false"
      );
    }
    if (dom.loginForm) dom.loginForm.hidden = !isLogin;
    if (dom.signupForm) dom.signupForm.hidden = isLogin;
  }

  function handleSignup() {
    var name = (dom.signupName.value || "").trim();
    var email = (dom.signupEmail.value || "").trim().toLowerCase();
    var password = dom.signupPassword.value || "";
    var confirm = dom.signupConfirm.value || "";

    // Reset highlights
    [dom.signupName, dom.signupEmail, dom.signupPassword, dom.signupConfirm]
      .forEach(function (el) { markInvalid(el, false); });

    if (!name) {
      markInvalid(dom.signupName, true);
      dom.signupError.textContent = "Please enter your name.";
      return;
    }
    var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      markInvalid(dom.signupEmail, true);
      dom.signupError.textContent = "Please enter a valid email address.";
      return;
    }
    if (password.length < 6) {
      markInvalid(dom.signupPassword, true);
      dom.signupError.textContent =
        "Password must be at least 6 characters long.";
      return;
    }
    if (password !== confirm) {
      markInvalid(dom.signupConfirm, true);
      dom.signupError.textContent = "Passwords do not match.";
      return;
    }
    if (findUser(email)) {
      markInvalid(dom.signupEmail, true);
      dom.signupError.textContent =
        "An account with this email already exists.";
      return;
    }

    dom.signupError.textContent = "";

    hashPassword(password).then(function (hash) {
      var users = loadUsers();
      var user = {
        name: name,
        email: email,
        passwordHash: hash,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      saveUsers(users);
      loginAs(user);
      closeAuthModal();
    });
  }

  function handleLogin() {
    var email = (dom.loginEmail.value || "").trim().toLowerCase();
    var password = dom.loginPassword.value || "";

    markInvalid(dom.loginEmail, false);
    markInvalid(dom.loginPassword, false);

    if (!email || !password) {
      markInvalid(dom.loginEmail, !email);
      markInvalid(dom.loginPassword, !password);
      dom.loginError.textContent = "Please enter email and password.";
      return;
    }

    var user = findUser(email);
    if (!user) {
      markInvalid(dom.loginEmail, true);
      dom.loginError.textContent = "No account found with that email.";
      return;
    }

    hashPassword(password).then(function (hash) {
      if (hash !== user.passwordHash) {
        markInvalid(dom.loginPassword, true);
        dom.loginError.textContent = "Incorrect password.";
        return;
      }
      dom.loginError.textContent = "";
      loginAs(user);
      closeAuthModal();
    });
  }

  // Activate a user session: sets current user, loads their budget,
  // updates the UI.
  function loginAs(user) {
    currentUser = user;
    setSession(user.email);
    state = loadBudgetFor(user.email);
    refreshAuthUI();
    renderAll();
  }

  function logout() {
    currentUser = null;
    state = { incomes: [], expenses: [] };
    clearSession();

    // Destroy chart so it doesn't leak the previous user's data
    if (expenseChart) {
      expenseChart.destroy();
      expenseChart = null;
    }

    refreshAuthUI();
    renderAll();
  }

  // Restore a previous session on page load.
  function restoreSession() {
    var sessionEmail = getSession();
    if (sessionEmail) {
      var user = findUser(sessionEmail);
      if (user) {
        loginAs(user);
        return;
      }
      // Session points to a user that no longer exists — clear it
      clearSession();
    }
    refreshAuthUI();
    renderAll();
  }

  // Update nav button + chip + login gate based on whether someone is signed in.
  function refreshAuthUI() {
    var loggedIn = !!currentUser;

    if (dom.openLoginBtn) dom.openLoginBtn.hidden = loggedIn;
    if (dom.userChip) dom.userChip.hidden = !loggedIn;
    if (dom.calculatorGrid) dom.calculatorGrid.hidden = !loggedIn;
    if (dom.loginGate) dom.loginGate.hidden = loggedIn;
    if (dom.resetBtn) dom.resetBtn.hidden = !loggedIn;

    if (loggedIn) {
      var firstName = currentUser.name.split(/\s+/)[0];
      if (dom.userChipName) dom.userChipName.textContent = "Hi, " + firstName;
      if (dom.userChipAvatar) {
        dom.userChipAvatar.textContent = currentUser.name
          .charAt(0)
          .toUpperCase();
      }
    }
  }

  /* =========================================================================
     MOBILE NAVIGATION
     ========================================================================= */
  function setupMobileNav() {
    if (!dom.menuToggle || !dom.navLinks) return;

    dom.menuToggle.addEventListener("click", function () {
      dom.navLinks.classList.toggle("open");
    });

    var links = dom.navLinks.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener("click", function () {
        dom.navLinks.classList.remove("open");
      });
    }
  }

  /* =========================================================================
     SMOOTH SCROLL
     ========================================================================= */
  function setupSmoothScroll() {
    var anchors = document.querySelectorAll('a[href^="#"]');
    for (var i = 0; i < anchors.length; i++) {
      anchors[i].addEventListener("click", function (e) {
        var hash = this.getAttribute("href");
        if (!hash || hash === "#") return;
        var target = document.querySelector(hash);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  /* =========================================================================
     SCROLL REVEAL ANIMATIONS
     ========================================================================= */
  function setupScrollReveal() {
    var revealEls = document.querySelectorAll(".reveal");

    if (!("IntersectionObserver" in window)) {
      for (var i = 0; i < revealEls.length; i++) {
        revealEls[i].classList.add("visible");
      }
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    revealEls.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* =========================================================================
     BUDGET CALCULATOR — INCOME & EXPENSE FORMS
     ========================================================================= */
  function setupBudgetCalculator() {
    if (dom.incomeForm) {
      dom.incomeForm.addEventListener("submit", function (e) {
        e.preventDefault();
        handleEntrySubmit("income");
      });
    }
    if (dom.expenseForm) {
      dom.expenseForm.addEventListener("submit", function (e) {
        e.preventDefault();
        handleEntrySubmit("expense");
      });
    }
  }

  function handleEntrySubmit(type) {
    if (!currentUser) {
      openAuthModal("login");
      return;
    }

    var nameInput = type === "income" ? dom.incomeName : dom.expenseName;
    var amountInput = type === "income" ? dom.incomeAmount : dom.expenseAmount;
    var errorEl = type === "income" ? dom.incomeError : dom.expenseError;

    var name = nameInput.value;
    var amount = amountInput.value;

    var nameError = validateName(name);
    var amountError = validateAmount(amount);

    markInvalid(nameInput, !!nameError);
    markInvalid(amountInput, !!amountError);

    if (nameError || amountError) {
      errorEl.textContent = nameError || amountError;
      return;
    }

    errorEl.textContent = "";

    var entry = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      name: name.trim(),
      amount: Number(amount),
    };

    updateState(function (s) {
      if (type === "income") s.incomes.push(entry);
      else s.expenses.push(entry);
    });

    nameInput.value = "";
    amountInput.value = "";
    nameInput.focus();
  }

  function deleteEntry(type, id) {
    updateState(function (s) {
      var list = type === "income" ? s.incomes : s.expenses;
      var idx = list.findIndex(function (item) { return item.id === id; });
      if (idx !== -1) list.splice(idx, 1);
    });
  }

  /* =========================================================================
     RESET BUTTON
     ========================================================================= */
  function setupResetButton() {
    if (!dom.resetBtn) return;
    dom.resetBtn.addEventListener("click", function () {
      if (!currentUser) return;
      var ok = confirm(
        "Reset all income and expense data for this account? This cannot be undone."
      );
      if (!ok) return;
      updateState(function (s) {
        s.incomes = [];
        s.expenses = [];
      });
    });
  }

  /* =========================================================================
     RENDERING
     ========================================================================= */
  function renderAll() {
    var totals = computeTotals();
    renderSummary(totals);
    renderStatus(totals);
    renderEntryList("income");
    renderEntryList("expense");
    renderChart();
  }

  function computeTotals() {
    var totalIncome = sumAmounts(state.incomes);
    var totalExpense = sumAmounts(state.expenses);
    var balance = totalIncome - totalExpense;
    var savingsRate = totalIncome > 0 ? (balance / totalIncome) * 100 : 0;
    return {
      income: totalIncome,
      expense: totalExpense,
      balance: balance,
      savingsRate: savingsRate,
    };
  }

  function setMoneyText(el, value) {
    if (!el) return;
    var formatted = formatCurrency(value);
    if (el.textContent !== formatted) {
      el.textContent = formatted;
      flash(el);
    }
  }

  function renderSummary(totals) {
    setMoneyText(dom.totalIncome, totals.income);
    setMoneyText(dom.totalExpense, totals.expense);
    setMoneyText(dom.balance, totals.balance);
  }

  function renderStatus(totals) {
    var banner = dom.statusBanner;
    if (!banner) return;

    banner.classList.remove("is-positive", "is-negative", "is-warning");

    if (totals.income === 0 && totals.expense === 0) {
      banner.textContent = "Add some entries to see your financial status.";
      return;
    }
    if (totals.income === 0) {
      banner.classList.add("is-warning");
      banner.textContent =
        "You have expenses but no income recorded yet. Add an income source to see your savings rate.";
      return;
    }
    if (totals.balance < 0) {
      banner.classList.add("is-negative");
      banner.textContent =
        "Deficit: you are spending " +
        formatCurrency(Math.abs(totals.balance)) +
        " more than you earn. Consider trimming expenses.";
      return;
    }
    if (totals.savingsRate < 10) {
      banner.classList.add("is-warning");
      banner.textContent =
        "Surplus: " +
        formatCurrency(totals.balance) +
        " saved (" +
        totals.savingsRate.toFixed(1) +
        "% of income). Try to push savings above 10%.";
      return;
    }
    banner.classList.add("is-positive");
    banner.textContent =
      "Healthy! You're saving " +
      formatCurrency(totals.balance) +
      " — that's " +
      totals.savingsRate.toFixed(1) +
      "% of your income.";
  }

  function renderEntryList(type) {
    var listEl = type === "income" ? dom.incomeList : dom.expenseList;
    var emptyEl = type === "income" ? dom.incomeEmpty : dom.expenseEmpty;
    var data = type === "income" ? state.incomes : state.expenses;

    if (!listEl || !emptyEl) return;

    if (data.length === 0) {
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";

    var fragment = document.createDocumentFragment();
    data.forEach(function (item) {
      fragment.appendChild(createEntryRow(type, item));
    });

    listEl.innerHTML = "";
    listEl.appendChild(fragment);
  }

  function createEntryRow(type, item) {
    var li = document.createElement("li");

    var nameSpan = document.createElement("span");
    nameSpan.className = "item-name";
    nameSpan.textContent = item.name;

    var amountSpan = document.createElement("span");
    amountSpan.className =
      "item-amount " +
      (type === "income" ? "income-amount" : "expense-amount");
    amountSpan.textContent =
      (type === "income" ? "+" : "-") + formatCurrency(item.amount);

    var deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.setAttribute("aria-label", "Delete entry");
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", function () {
      deleteEntry(type, item.id);
    });

    li.appendChild(nameSpan);
    li.appendChild(amountSpan);
    li.appendChild(deleteBtn);
    return li;
  }

  /* =========================================================================
     PIE CHART
     ========================================================================= */
  function renderChart() {
    var canvas = dom.expenseChartCanvas;
    var emptyMsg = dom.chartEmpty;
    if (!canvas || typeof Chart === "undefined") return;

    var totals = {};
    for (var i = 0; i < state.expenses.length; i++) {
      var item = state.expenses[i];
      var key = item.name || "Other";
      totals[key] = (totals[key] || 0) + Number(item.amount);
    }

    var labels = Object.keys(totals);
    var values = labels.map(function (label) { return totals[label]; });

    if (labels.length === 0) {
      if (emptyMsg) emptyMsg.style.display = "flex";
      canvas.style.display = "none";
      if (expenseChart) {
        expenseChart.destroy();
        expenseChart = null;
      }
      return;
    }

    if (emptyMsg) emptyMsg.style.display = "none";
    canvas.style.display = "block";

    var colors = labels.map(function (_, i) {
      return CHART_PALETTE[i % CHART_PALETTE.length];
    });

    if (expenseChart) {
      expenseChart.data.labels = labels;
      expenseChart.data.datasets[0].data = values;
      expenseChart.data.datasets[0].backgroundColor = colors;
      expenseChart.update();
      return;
    }

    expenseChart = new Chart(canvas.getContext("2d"), {
      type: "pie",
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: "#ffffff",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: "#1a2332",
              font: { family: "Inter, sans-serif", size: 13 },
              padding: 14,
              boxWidth: 12,
              boxHeight: 12,
              usePointStyle: true,
            },
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                var value = context.parsed || 0;
                var total = context.dataset.data.reduce(function (a, b) {
                  return a + b;
                }, 0);
                var pct = total ? ((value / total) * 100).toFixed(1) : 0;
                return (
                  context.label +
                  ": " +
                  formatCurrency(value) +
                  " (" +
                  pct +
                  "%)"
                );
              },
            },
          },
        },
      },
    });
  }

  /* =========================================================================
     FINANCIAL TOOLS
     ========================================================================= */
  function showToolResult(el, text, isError) {
    if (!el) return;
    el.textContent = text;
    el.classList.add("visible");
    if (isError) el.classList.add("is-error");
    else el.classList.remove("is-error");
  }

  function setupSavingsTool() {
    if (!dom.calcGoalBtn) return;
    dom.calcGoalBtn.addEventListener("click", function () {
      var amount = Number(dom.goalAmount.value);
      var months = Number(dom.goalMonths.value);

      if (!dom.goalAmount.value || !dom.goalMonths.value) {
        return showToolResult(dom.goalResult, "Please fill in both fields.", true);
      }
      if (amount <= 0 || months <= 0) {
        return showToolResult(dom.goalResult, "Both values must be greater than 0.", true);
      }

      var perMonth = amount / months;
      showToolResult(
        dom.goalResult,
        "Save " + formatCurrency(perMonth) + " each month to reach your goal."
      );
    });
  }

  function setupProfitMarginTool() {
    if (!dom.calcMarginBtn) return;
    dom.calcMarginBtn.addEventListener("click", function () {
      var revenue = Number(dom.revenueInput.value);
      var cost = Number(dom.costInput.value);

      if (!dom.revenueInput.value || dom.costInput.value === "") {
        return showToolResult(dom.marginResult, "Please fill in both fields.", true);
      }
      if (revenue <= 0 || cost < 0) {
        return showToolResult(
          dom.marginResult,
          "Revenue must be > 0 and cost cannot be negative.",
          true
        );
      }

      var profit = revenue - cost;
      var margin = (profit / revenue) * 100;
      showToolResult(
        dom.marginResult,
        "Profit: " + formatCurrency(profit) + " — Margin: " + margin.toFixed(1) + "%"
      );
    });
  }

  function setupLoanTool() {
    if (!dom.calcLoanBtn) return;
    dom.calcLoanBtn.addEventListener("click", function () {
      var principal = Number(dom.loanAmount.value);
      var annualRate = Number(dom.loanRate.value);
      var years = Number(dom.loanYears.value);

      if (!dom.loanAmount.value || dom.loanRate.value === "" || !dom.loanYears.value) {
        return showToolResult(dom.loanResult, "Please fill in all three fields.", true);
      }
      if (principal <= 0 || annualRate < 0 || years <= 0) {
        return showToolResult(
          dom.loanResult,
          "Loan amount and years must be > 0; rate cannot be negative.",
          true
        );
      }

      var monthlyRate = annualRate / 100 / 12;
      var n = years * 12;
      var monthly =
        monthlyRate === 0
          ? principal / n
          : (principal * monthlyRate * Math.pow(1 + monthlyRate, n)) /
            (Math.pow(1 + monthlyRate, n) - 1);

      var total = monthly * n;
      showToolResult(
        dom.loanResult,
        "Monthly payment: " + formatCurrency(monthly) + " — Total paid: " + formatCurrency(total)
      );
    });
  }

  /* =========================================================================
     CONTACT FORM
     ========================================================================= */
  function setupContactForm() {
    if (!dom.contactForm) return;

    dom.contactForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var name = (dom.contactName.value || "").trim();
      var email = (dom.contactEmail.value || "").trim();
      var message = (dom.contactMessage.value || "").trim();

      dom.contactSuccess.textContent = "";
      markInvalid(dom.contactName, false);
      markInvalid(dom.contactEmail, false);
      markInvalid(dom.contactMessage, false);

      if (!name || !email || !message) {
        markInvalid(dom.contactName, !name);
        markInvalid(dom.contactEmail, !email);
        markInvalid(dom.contactMessage, !message);
        dom.contactError.textContent = "Please fill in every field.";
        return;
      }

      var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(email)) {
        markInvalid(dom.contactEmail, true);
        dom.contactError.textContent = "Please enter a valid email address.";
        return;
      }

      dom.contactError.textContent = "";
      dom.contactSuccess.textContent =
        "Thanks " + name + "! Your message has been received.";

      dom.contactForm.reset();
    });
  }
})();
