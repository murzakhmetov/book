/**
 * book_lovers.kz - Supabase Database Configuration
 *
 * База данных Supabase подключена для сохранения пользователей, заказов и избранного:
 * - URL проекта: https://grazmukqoglnedyzlxue.supabase.co
 * - Anon Key: sb_publishable_qSIoQs6qkLhT3z6tDXCPIw_PUPrZOlN
 */
(function () {
  "use strict";

  var STORAGE_KEY = "bl-supabase-config";
  var saved = null;
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) {}

  window.SUPABASE_CONFIG = {
    // URL проекта Supabase
    url: (saved && saved.url) ? saved.url.trim() : "https://grazmukqoglnedyzlxue.supabase.co",

    // Публичный anon / publishable ключ Supabase
    anonKey: (saved && saved.anonKey) ? saved.anonKey.trim() : "sb_publishable_qSIoQs6qkLhT3z6tDXCPIw_PUPrZOlN"
  };
})();
