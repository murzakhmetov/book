/**
 * book_lovers.kz - Supabase Client & Database Services
 *
 * Предоставляет полный интерфейс для работы с базой данных Supabase:
 * - Аутентификация (регистрация, вход, выход, сессии)
 * - Профили пользователей (имя, телефон, адрес доставки)
 * - Сохранение и получение заказов из таблицы public.orders
 * - Синхронизация избранных книг в таблице public.favorites
 * - Сохранение корзины в таблице public.cart_items
 * - Резервное сохранение в localStorage при отсутствии интернета или ключей
 */
(function () {
  "use strict";

  var STORAGE_CONFIG_KEY = "bl-supabase-config";
  var client = null;
  var isInitialized = false;

  function initClient() {
    var conf = window.SUPABASE_CONFIG || {};
    var url = (conf.url || "").trim();
    var anonKey = (conf.anonKey || "").trim();

    if (!url || !anonKey || typeof window.supabase === "undefined" || !window.supabase.createClient) {
      client = null;
      isInitialized = false;
      return null;
    }

    try {
      client = window.supabase.createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      isInitialized = true;
      return client;
    } catch (err) {
      console.warn("Supabase initialization failed:", err);
      client = null;
      isInitialized = false;
      return null;
    }
  }

  // Initialize immediately if credentials are present
  initClient();

  var BL_DB = {
    /**
     * Проверка, инициализирован ли клиент Supabase
     */
    isReady: function () {
      return !!(client && isInitialized);
    },

    /**
     * Проверка, введены ли URL и Anon-ключ
     */
    isConfigured: function () {
      var conf = window.SUPABASE_CONFIG || {};
      return !!(conf.url && conf.anonKey);
    },

    /**
     * Получить текущие настройки Supabase
     */
    getConfig: function () {
      var conf = window.SUPABASE_CONFIG || {};
      return {
        url: conf.url || "",
        anonKey: conf.anonKey || ""
      };
    },

    /**
     * Сохранить новые настройки Supabase и переподключиться
     */
    saveConfig: function (url, anonKey) {
      url = (url || "").trim();
      anonKey = (anonKey || "").trim();
      var conf = { url: url, anonKey: anonKey };
      try {
        localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(conf));
      } catch (e) {}
      window.SUPABASE_CONFIG = conf;
      return initClient();
    },

    /**
     * Тест подключения к Supabase
     */
    testConnection: async function () {
      if (!this.isReady()) {
        if (!initClient()) {
          return { ok: false, message: "Supabase клиент не настроен (проверьте URL и ключ)" };
        }
      }
      try {
        var res = await client.from("orders").select("id").limit(1);
        if (res.error) {
          // Если таблица еще не создана, но к API подключились
          if (res.error.code === "42P01" || res.error.message.indexOf("does not exist") !== -1) {
            return {
              ok: true,
              tablesMissing: true,
              message: "Подключение успешно! Таблицы еще не созданы. Выполните скрипт supabase/schema.sql в SQL Editor."
            };
          }
          return { ok: false, message: res.error.message || "Ошибка запроса к Supabase" };
        }
        return { ok: true, message: "Соединение с базой данных Supabase успешно установлено!" };
      } catch (err) {
        return { ok: false, message: err.message || "Сетевая ошибка при обращении к Supabase" };
      }
    },

    /* ==================================================================== AUTH */
    /**
     * Регистрация нового покупателя через Supabase Auth
     */
    signUp: async function (email, password, profileData) {
      if (!this.isReady()) {
        throw new Error("Supabase не подключен");
      }
      email = (email || "").trim().toLowerCase();
      var meta = {
        name: (profileData && profileData.name) || "",
        phone: (profileData && profileData.phone) || "",
        address: (profileData && profileData.address) || "",
        role: "customer"
      };

      // 1. Попытка быстрой регистрации через хранимую процедуру без лимитов email rate limit
      try {
        var rpcRes = await client.rpc("register_customer", {
          p_email: email,
          p_password: password,
          p_name: meta.name,
          p_phone: meta.phone,
          p_address: meta.address
        });

        if (rpcRes.error) {
          console.warn("RPC register_customer notice:", rpcRes.error);
        } else if (rpcRes.data) {
          if (rpcRes.data.success === false) {
            throw new Error(rpcRes.data.error || "Ошибка регистрации");
          }
          if (rpcRes.data.success === true) {
            // Мгновенный вход под созданным пользователем
            var loginRes = await client.auth.signInWithPassword({
              email: email,
              password: password
            });
            if (!loginRes.error && loginRes.data && loginRes.data.user) {
              return {
                user: loginRes.data.user,
                session: loginRes.data.session,
                needsEmailConfirmation: false
              };
            }
          }
        }
      } catch (rpcErr) {
        if (rpcErr.message && (rpcErr.message.indexOf("уже существует") !== -1 || rpcErr.message.indexOf("обязательны") !== -1)) {
          throw rpcErr;
        }
        console.warn("RPC fallback to client.auth.signUp:", rpcErr);
      }

      // 2. Стандартный метод регистрации Supabase Auth (fallback)
      var res = await client.auth.signUp({
        email: email,
        password: password,
        options: {
          data: meta
        }
      });

      if (res.error) throw res.error;

      var user = res.data.user;
      if (user) {
        // Дополнительно обновляем/создаем запись в profiles
        try {
          await client.from("profiles").upsert({
            id: user.id,
            email: email,
            name: meta.name,
            phone: meta.phone,
            address: meta.address,
            role: "customer",
            updated_at: new Date().toISOString()
          });
        } catch (e) {
          console.warn("Profile upsert notice:", e);
        }
      }

      return {
        user: user,
        session: res.data.session,
        needsEmailConfirmation: !res.data.session && !!user
      };
    },

    /**
     * Вход покупателя через Supabase Auth
     */
    signIn: async function (email, password) {
      if (!this.isReady()) {
        throw new Error("Supabase не подключен");
      }
      email = (email || "").trim().toLowerCase();
      var res = await client.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (res.error) throw res.error;

      var user = res.data.user;
      var profile = await this.getProfile(user.id);

      return {
        user: user,
        session: res.data.session,
        profile: profile
      };
    },

    /**
     * Выход из аккаунта
     */
    signOut: async function () {
      if (client) {
        try {
          await client.auth.signOut();
        } catch (e) {
          console.warn("SignOut error:", e);
        }
      }
    },

    /**
     * Получить текущую сессию
     */
    getSession: async function () {
      if (!this.isReady()) return null;
      try {
        var res = await client.auth.getSession();
        return res.data ? res.data.session : null;
      } catch (e) {
        return null;
      }
    },

    /**
     * Подписка на изменение состояния аутентификации
     */
    onAuthStateChange: function (callback) {
      if (!this.isReady()) return { unsubscribe: function () {} };
      try {
        var sub = client.auth.onAuthStateChange(function (event, session) {
          callback(event, session);
        });
        return sub.data ? sub.data.subscription : { unsubscribe: function () {} };
      } catch (e) {
        return { unsubscribe: function () {} };
      }
    },

    /* ==================================================================== PROFILES */
    /**
     * Получить профиль пользователя из таблицы public.profiles
     */
    getProfile: async function (userId) {
      if (!this.isReady() || !userId) return null;
      try {
        var res = await client.from("profiles").select("*").eq("id", userId).single();
        if (res.error) {
          console.warn("Could not fetch profile:", res.error.message);
          return null;
        }
        return res.data;
      } catch (e) {
        return null;
      }
    },

    /**
     * Обновить профиль пользователя
     */
    updateProfile: async function (userId, data) {
      if (!this.isReady() || !userId) return null;
      var patch = {
        updated_at: new Date().toISOString()
      };
      if (data.name !== undefined) patch.name = data.name.trim();
      if (data.phone !== undefined) patch.phone = data.phone.trim();
      if (data.address !== undefined) patch.address = data.address.trim();

      var res = await client.from("profiles").update(patch).eq("id", userId).select().single();
      if (res.error) throw res.error;
      return res.data;
    },

    /* ==================================================================== ORDERS */
    /**
     * Сохранить новый заказ в public.orders
     */
    createOrder: async function (order) {
      var record = {
        id: order.id,
        user_id: (order.customer && order.customer.id) || null,
        customer_name: (order.customer && order.customer.name) || "",
        customer_phone: (order.customer && order.customer.phone) || "",
        contact_method: (order.customer && order.customer.contact) || "whatsapp",
        delivery_method: (order.delivery && order.delivery.method) || "courier",
        delivery_city: (order.delivery && order.delivery.city) || "",
        delivery_address: (order.delivery && order.delivery.address) || "",
        delivery_fee: (order.delivery && order.delivery.fee) || 0,
        payment_method: order.payment || "transfer",
        comment: order.comment || "",
        items: order.items || [],
        subtotal: order.subtotal || 0,
        discount: order.discount || 0,
        total: order.total || 0,
        status: order.status || "new",
        created_at: order.date || new Date().toISOString()
      };

      if (this.isReady()) {
        try {
          var res = await client.from("orders").insert(record);
          if (res.error) {
            console.error("Supabase insert order error:", res.error);
          } else {
            return record;
          }
        } catch (err) {
          console.error("Failed to insert order to Supabase:", err);
        }
      }
      return record;
    },

    /**
     * Загрузить заказы конкретного пользователя
     */
    getUserOrders: async function (userId) {
      if (!this.isReady() || !userId) return [];
      try {
        var res = await client.from("orders").select("*").eq("user_id", userId).order("created_at", { ascending: false });
        if (res.error) {
          console.warn("getUserOrders error:", res.error.message);
          return [];
        }
        return res.data || [];
      } catch (e) {
        return [];
      }
    },

    /**
     * Загрузить все заказы (для владельца магазина)
     */
    getAllOrders: async function () {
      if (!this.isReady()) return [];
      try {
        var res = await client.from("orders").select("*").order("created_at", { ascending: false });
        if (res.error) {
          console.warn("getAllOrders error:", res.error.message);
          return [];
        }
        return res.data || [];
      } catch (e) {
        return [];
      }
    },

    /**
     * Обновить статус заказа
     */
    updateOrderStatus: async function (orderId, newStatus) {
      if (!this.isReady() || !orderId) return false;
      try {
        var res = await client.from("orders").update({ status: newStatus }).eq("id", orderId);
        return !res.error;
      } catch (e) {
        return false;
      }
    },

    /**
     * Удалить заказ
     */
    deleteOrder: async function (orderId) {
      if (!this.isReady() || !orderId) return false;
      try {
        var res = await client.from("orders").delete().eq("id", orderId);
        return !res.error;
      } catch (e) {
        return false;
      }
    },

    /* ==================================================================== FAVORITES */
    /**
     * Загрузить список избранных книг пользователя
     */
    getFavorites: async function (userId) {
      if (!this.isReady() || !userId) return [];
      try {
        var res = await client.from("favorites").select("book_id").eq("user_id", userId);
        if (res.error) return [];
        return (res.data || []).map(function (row) { return row.book_id; });
      } catch (e) {
        return [];
      }
    },

    /**
     * Добавить книгу в избранное
     */
    addFavorite: async function (userId, bookId) {
      if (!this.isReady() || !userId || !bookId) return false;
      try {
        var res = await client.from("favorites").upsert({ user_id: userId, book_id: bookId });
        return !res.error;
      } catch (e) {
        return false;
      }
    },

    /**
     * Удалить книгу из избранного
     */
    removeFavorite: async function (userId, bookId) {
      if (!this.isReady() || !userId || !bookId) return false;
      try {
        var res = await client.from("favorites").delete().eq("user_id", userId).eq("book_id", bookId);
        return !res.error;
      } catch (e) {
        return false;
      }
    },

    /**
     * Синхронизировать локальное избранное с базой Supabase
     */
    syncFavorites: async function (userId, localFavs) {
      if (!this.isReady() || !userId) return localFavs || [];
      try {
        var dbFavs = await this.getFavorites(userId);
        var set = {};
        (dbFavs || []).forEach(function (id) { set[id] = true; });
        (localFavs || []).forEach(function (id) { set[id] = true; });
        var merged = Object.keys(set);

        // Добавляем недостающие в Supabase
        var toInsert = (localFavs || []).filter(function (id) { return dbFavs.indexOf(id) === -1; });
        if (toInsert.length > 0) {
          var rows = toInsert.map(function (bId) { return { user_id: userId, book_id: bId }; });
          await client.from("favorites").upsert(rows);
        }
        return merged;
      } catch (e) {
        return localFavs || [];
      }
    },

    /* ==================================================================== CART */
    /**
     * Загрузить сохраненную корзину пользователя
     */
    getCart: async function (userId) {
      if (!this.isReady() || !userId) return null;
      try {
        var res = await client.from("cart_items").select("book_id, quantity").eq("user_id", userId);
        if (res.error || !res.data) return null;
        var cart = {};
        res.data.forEach(function (item) {
          cart[item.book_id] = item.quantity;
        });
        return cart;
      } catch (e) {
        return null;
      }
    },

    /**
     * Сохранить корзину в Supabase
     */
    saveCart: async function (userId, cartMap) {
      if (!this.isReady() || !userId) return;
      try {
        var rows = Object.keys(cartMap).map(function (bookId) {
          return {
            user_id: userId,
            book_id: bookId,
            quantity: cartMap[bookId],
            updated_at: new Date().toISOString()
          };
        });
        // Сначала удаляем старую корзину пользователя
        await client.from("cart_items").delete().eq("user_id", userId);
        if (rows.length > 0) {
          await client.from("cart_items").insert(rows);
        }
      } catch (e) {
        console.warn("saveCart notice:", e);
      }
    },

    /* ==================================================================== REVIEWS */
    /**
     * Загрузить отзывы из базы данных Supabase.
     * @param {boolean} onlyApproved - загрузить только опубликованные (для покупателей)
     */
    getReviews: async function (onlyApproved) {
      if (!this.isReady()) return null;
      try {
        var query = client.from("reviews").select("*").order("created_at", { ascending: false });
        if (onlyApproved) {
          query = query.eq("status", "approved");
        }
        var res = await query;
        if (res.error) {
          console.warn("getReviews notice:", res.error.message);
          return null;
        }
        return res.data || [];
      } catch (e) {
        console.warn("getReviews error:", e);
        return null;
      }
    },

    /**
     * Сохранить / обновить отзыв в Supabase
     */
    saveReview: async function (review) {
      if (!this.isReady() || !review) return null;
      try {
        var row = {
          id: review.id || ("r" + Date.now()),
          name: (review.name || "").trim(),
          book: (review.book || "").trim(),
          rating: +review.rating || 5,
          text: (review.text || "").trim(),
          lang: review.lang || "ru",
          sample: !!review.sample,
          status: review.status || "approved",
          date: review.date || new Date().toISOString().slice(0, 10)
        };
        var res = await client.from("reviews").upsert(row);
        if (res.error) {
          console.error("saveReview error:", res.error);
          return null;
        }
        return row;
      } catch (e) {
        console.error("saveReview exception:", e);
        return null;
      }
    },

    /**
     * Обновить статус отзыва ('approved' или 'hidden')
     */
    updateReviewStatus: async function (reviewId, newStatus) {
      if (!this.isReady() || !reviewId) return false;
      try {
        var res = await client.from("reviews").update({ status: newStatus }).eq("id", reviewId);
        return !res.error;
      } catch (e) {
        return false;
      }
    },

    /**
     * Удалить отзыв из Supabase
     */
    deleteReview: async function (reviewId) {
      if (!this.isReady() || !reviewId) return false;
      try {
        var res = await client.from("reviews").delete().eq("id", reviewId);
        return !res.error;
      } catch (e) {
        return false;
      }
    },

    /**
     * Опубликовать все отзывы из массива в Supabase (синхронизация)
     */
    publishAllReviews: async function (reviewsList) {
      if (!this.isReady() || !reviewsList || !reviewsList.length) return false;
      try {
        var rows = reviewsList.map(function (r) {
          return {
            id: r.id || ("r" + Date.now()),
            name: (r.name || "").trim(),
            book: (r.book || "").trim(),
            rating: +r.rating || 5,
            text: (r.text || "").trim(),
            lang: r.lang || "ru",
            sample: !!r.sample,
            status: r.status || "approved",
            date: r.date || new Date().toISOString().slice(0, 10)
          };
        });
        var res = await client.from("reviews").upsert(rows);
        return !res.error;
      } catch (e) {
        console.error("publishAllReviews exception:", e);
        return false;
      }
    },

    /* ==================================================================== STORAGE: COVERS */
    /**
     * Загрузить обложку книги в Supabase Storage (bucket 'covers')
     * Возвращает постоянную публичную HTTPS ссылку на изображение.
     */
    uploadCover: async function (file) {
      if (!file) return { ok: false, message: "Файл не выбран" };
      var cleanName = (file.name || "cover.jpg").toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      var filename = "cover-" + Date.now() + "-" + cleanName;

      // 1. Если Supabase подключен, загружаем в облачный Storage bucket 'covers'
      if (this.isReady()) {
        try {
          var uploadRes = await client.storage.from("covers").upload(filename, file, {
            cacheControl: "3600",
            upsert: true
          });
          if (!uploadRes.error) {
            var urlRes = client.storage.from("covers").getPublicUrl(filename);
            if (urlRes && urlRes.data && urlRes.data.publicUrl) {
              return { ok: true, url: urlRes.data.publicUrl, filename: filename };
            }
          } else {
            console.warn("Supabase Storage upload warning:", uploadRes.error);
          }
        } catch (e) {
          console.warn("Supabase Storage exception:", e);
        }
      }

      // 2. Резервный вариант: Data URL (base64)
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function (e) {
          resolve({ ok: true, url: e.target.result, filename: filename, fallback: true });
        };
        reader.onerror = function () {
          resolve({ ok: false, message: "Ошибка чтения файла" });
        };
        reader.readAsDataURL(file);
      });
    },

    /* ==================================================================== STORE DATA & SETTINGS */
    /**
     * Получить данные магазина из Supabase (настройки, товары, акции)
     */
    getStoreData: async function (key) {
      if (!this.isReady() || !key) return null;
      try {
        var res = await client.from("store_data").select("value").eq("key", key).maybeSingle();
        if (res.error || !res.data) return null;
        return res.data.value;
      } catch (e) {
        return null;
      }
    },

    /**
     * Получить все сохранённые данные магазина (settings, products, promotions)
     */
    getAllStoreData: async function () {
      if (!this.isReady()) return null;
      try {
        var res = await client.from("store_data").select("key, value");
        if (res.error || !res.data) return null;
        var out = {};
        res.data.forEach(function (row) {
          out[row.key] = row.value;
        });
        return out;
      } catch (e) {
        return null;
      }
    },

    /**
     * Сохранить отдельный раздел данных в Supabase (например 'settings')
     */
    saveStoreData: async function (key, value) {
      if (!this.isReady() || !key) return false;
      try {
        var res = await client.from("store_data").upsert({
          key: key,
          value: value,
          updated_at: new Date().toISOString()
        });
        return !res.error;
      } catch (e) {
        console.error("saveStoreData error:", e);
        return false;
      }
    },

    /**
     * Комплексная публикация всех данных магазина в Supabase:
     * - Настройки магазина (S.settings)
     * - Товары/книги (S.products)
     * - Акции (S.promotions)
     * - Отзывы (S.reviews)
     */
    publishStoreData: async function (storeObj) {
      if (!this.isReady() || !storeObj) return false;
      try {
        var promises = [];
        if (storeObj.settings) {
          promises.push(this.saveStoreData("settings", storeObj.settings));
        }
        if (storeObj.products && storeObj.products.length) {
          promises.push(this.saveStoreData("products", storeObj.products));
        }
        if (storeObj.promotions) {
          promises.push(this.saveStoreData("promotions", storeObj.promotions));
        }
        if (storeObj.reviews && storeObj.reviews.length) {
          promises.push(this.publishAllReviews(storeObj.reviews));
        }
        var results = await Promise.all(promises);
        return results.every(function (r) { return !!r; });
      } catch (e) {
        console.error("publishStoreData exception:", e);
        return false;
      }
    }
  };

  window.BL_DB = BL_DB;
})();
