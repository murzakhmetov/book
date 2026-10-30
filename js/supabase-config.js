/**
 * book_lovers.kz - Supabase Database Configuration
 *
 * Подключение базы данных Supabase для сохранения пользователей, заказов и избранного:
 * 1. Создайте проект на https://supabase.com (бесплатно).
 * 2. Перейдите в Project Settings -> API.
 * 3. Скопируйте Project URL и anon / publishable key и укажите их ниже:
 *    (Также их можно ввести прямо в админ-панели сайта во вкладке "Настройки").
 * 4. Запустите скрипт из файла supabase/schema.sql в SQL Editor вашего проекта Supabase.
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
    // URL проекта Supabase (например: "https://xyzcompany.supabase.co")
    url: (saved && saved.url) ? saved.url.trim() : "",

    // Публичный anon / publishable ключ Supabase
    anonKey: (saved && saved.anonKey) ? saved.anonKey.trim() : ""
  };
})();
