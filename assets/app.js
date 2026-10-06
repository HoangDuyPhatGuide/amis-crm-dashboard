/* AMIS CRM dashboard - static frontend; credentials must remain in the proxy. */
const MONEY = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
const STALE_DAYS = 60;
const QUOTE_THRESHOLD = 7_000_000;
const state = { preset: "today", range: null, data: null, config: getConfig() };

const $ = (selector) => document.querySelector(selector);
const byId = (id) => document.getElementById(id);
function getConfig() { try { return { demo: true, proxyUrl: "", ...JSON.parse(localStorage.getItem("amisDashboardConfig") || "{}") }; } catch { return { demo: true, proxyUrl: "" }; } }
function localDate(date = new Date()) { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10); }
function asDate(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(+d) ? null : d; }
function dateKey(value) { const date = asDate(value); return date ? localDate(date) : ""; }
function plusDays(value, days) { const d = new Date(`${value}T00:00:00`); d.setDate(d.getDate() + days); return localDate(d); }
function daysBetween(from, to = new Date()) { const a = asDate(from); if (!a) return null; return Math.max(0, Math.floor((new Date(to).setHours(0,0,0,0) - new Date(a).setHours(0,0,0,0)) / 86_400_000)); }
function money(value) { return MONEY.format(Number(value || 0)); }
function esc(value) { return String(value ?? "—").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c])); }

function getRange(preset) {
  const now = new Date(); const today = localDate(now);
  if (preset === "today") return { from: today, to: today, label: "Hôm nay" };
  if (preset === "week") { const day = now.getDay() || 7; return { from: plusDays(today, 1 - day), to: plusDays(today, 7 - day), label: "Tuần này" }; }
  if (preset === "month") return { from: `${today.slice(0, 7)}-01`, to: today, label: "Tháng này" };
  if (preset === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "Năm nay" };
  return state.range || { from: today, to: today, label: "Khoảng tuỳ chỉnh" };
}
function inRange(value, range) { const key = dateKey(value); return Boolean(key && key >= range.from && key <= range.to); }
function isBornOrder(quote, orders) { if (quote.orderId || quote.saleOrderId || quote.createdOrderId) return true; const qCode = String(quote.code || quote.quoteCode || ""); return orders.some(o => String(o.quoteCode || o.quotationCode || "") === qCode); }
function normOrder(row) { return { id: row.id || row.sale_order_id || row.saleOrderId, code: row.code || row.sale_order_code || row.saleOrderCode || "Chưa có mã", customerName: row.customerName || row.customer_name || row.customer?.name || "Chưa xác định", orderDate: row.orderDate || row.order_date || row.created_date || row.createdDate || row.modified_date, ownerName: row.ownerName || row.employee_name || row.sale_employee_name || row.employeeName || "—", amount: Number(row.amount ?? row.total_amount ?? row.totalAmount ?? row.total_money ?? 0), status: row.statusName || row.status_name || row.status || "Đang xử lý", quoteCode: row.quoteCode || row.quotationCode || "" }; }
function normCustomer(row) { return { id: row.id || row.customer_id, name: row.name || row.customer_name || row.customerName || "Chưa đặt tên", phone: row.phone || row.mobile || row.telephone || "—", ownerName: row.ownerName || row.employee_name || row.sale_employee_name || "—", lastPurchaseDate: row.lastPurchaseDate || row.last_purchase_date || row.lastOrderDate || null, totalPurchased: Number(row.totalPurchased ?? row.total_purchased ?? row.totalAmount ?? 0) }; }
function normQuote(row) { return { id: row.id || row.quote_id, code: row.code || row.quote_code || row.quotation_code || "Chưa có mã", customerName: row.customerName || row.customer_name || "Chưa xác định", quoteDate: row.quoteDate || row.quote_date || row.created_date || row.createdDate, ownerName: row.ownerName || row.employee_name || row.sale_employee_name || "—", amount: Number(row.amount ?? row.total_amount ?? row.totalAmount ?? 0), orderId: row.orderId || row.sale_order_id || row.created_order_id || null, quoteCode: row.quoteCode || row.code, status: row.statusName || row.status || "Chưa chốt" }; }

async function readDemo() { const response = await fetch("data/sample-data.json", { cache: "no-store" }); if (!response.ok) throw new Error("Không đọc được dữ liệu minh hoạ."); return response.json(); }
async function fetchDashboard(range) {
  if (state.config.demo || !state.config.proxyUrl) return readDemo();
  const root = state.config.proxyUrl.replace(/\/$/, "");
  const response = await fetch(`${root}/api/dashboard?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Máy chủ kết nối trả về lỗi ${response.status}.`);
  return response.json();
}
function normalize(data) { return { orders: (data.orders || data.saleOrders || []).map(normOrder), customers: (data.customers || []).map(normCustomer), quotes: (data.quotes || []).map(normQuote), quoteSourceConfigured: data.quoteSourceConfigured !== false, fetchedAt: data.fetchedAt || new Date().toISOString() }; }

function filtered() {
  const range = state.range; const orders = state.data.orders.filter(o => inRange(o.orderDate, range));
  const quotes = state.data.quotes.filter(q => q.amount > QUOTE_THRESHOLD && !isBornOrder(q, state.data.orders));
  const orderCustomerMap = new Map(); state.data.orders.forEach(o => { const key = o.customerName; const current = orderCustomerMap.get(key); if (!current || asDate(o.orderDate) > asDate(current.orderDate)) orderCustomerMap.set(key, o); });
  const customers = state.data.customers.map(c => { const derived = orderCustomerMap.get(c.name); return { ...c, lastPurchaseDate: c.lastPurchaseDate || derived?.orderDate || null, totalPurchased: c.totalPurchased || state.data.orders.filter(o => o.customerName === c.name).reduce((sum, o) => sum + o.amount, 0) }; }).filter(c => { const gap = daysBetween(c.lastPurchaseDate); return gap !== null && gap >= STALE_DAYS; }).sort((a,b) => daysBetween(b.lastPurchaseDate) - daysBetween(a.lastPurchaseDate));
  return { orders, quotes: quotes.sort((a,b) => b.amount - a.amount), customers };
}
function statusClass(status) { const text = String(status).toLowerCase(); return text.includes("hoàn") || text.includes("thành") || text.includes("ghi nhận") ? "success" : text.includes("chờ") || text.includes("xử lý") ? "pending" : "neutral"; }
function renderChart(orders) {
  const range = state.range; const days = []; for (let d = range.from; d <= range.to && days.length < 31; d = plusDays(d, 1)) days.push(d);
  if (days.length === 0) return; const values = days.map(day => orders.filter(o => dateKey(o.orderDate) === day).reduce((sum,o) => sum + o.amount, 0)); const max = Math.max(...values, 1); const width=680, height=210, pad={ left:8,right:8,top:18,bottom:27 }; const usableW=width-pad.left-pad.right, usableH=height-pad.top-pad.bottom;
  const coords = values.map((value,i) => ({ x: pad.left + (days.length === 1 ? usableW/2 : i*usableW/(days.length-1)), y: pad.top + usableH - value/max*usableH }));
  const grid = [0,.25,.5,.75,1].map(p => `<line class="grid-line" x1="${pad.left}" x2="${width-pad.right}" y1="${pad.top+usableH*(1-p)}" y2="${pad.top+usableH*(1-p)}" />`).join("");
  const labels = days.length <= 8 ? days : [days[0], days[Math.floor(days.length/2)], days.at(-1)]; const labelMarkup = labels.map((day, i) => { const idx=days.indexOf(day); return `<text class="chart-label" x="${coords[idx].x}" y="${height-7}" text-anchor="middle">${day.slice(8,10)}/${day.slice(5,7)}</text>`; }).join("");
  const points = coords.map(p => `${p.x},${p.y}`).join(" "); const area = `${pad.left},${pad.top+usableH} ${points} ${width-pad.right},${pad.top+usableH}`;
  byId("chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"><defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3765ed" stop-opacity=".23"/><stop offset="100%" stop-color="#3765ed" stop-opacity="0"/></linearGradient></defs>${grid}<polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${points}"/>${coords.filter((_,i) => days.length <= 12 || i===0 || i===coords.length-1 || i===Math.floor(coords.length/2)).map(p => `<circle class="chart-point" cx="${p.x}" cy="${p.y}" r="3"/>`).join("")}${labelMarkup}</svg>`;
}
function emptyRow(message, cells) { return `<tr class="empty-row"><td colspan="${cells}">${esc(message)}</td></tr>`; }
function renderTables({orders, quotes, customers}) {
  const priorityItems = [];
  if (quotes.length) priorityItems.push(`<li class="priority-item"><span class="priority-symbol">!</span><p><strong>${quotes.length} báo giá chưa sinh đơn</strong>Tổng giá trị cần theo sát: ${money(quotes.reduce((s,q)=>s+q.amount,0))}</p></li>`);
  if (customers.length) priorityItems.push(`<li class="priority-item info"><span class="priority-symbol">♙</span><p><strong>${customers.length} khách cần tái chăm sóc</strong>${customers[0].name} đã ${daysBetween(customers[0].lastPurchaseDate)} ngày chưa mua.</p></li>`);
  if (!priorityItems.length) priorityItems.push(`<li class="priority-item info"><span class="priority-symbol">✓</span><p><strong>Chưa có cảnh báo nổi bật</strong>Tiếp tục theo dõi dữ liệu trong kỳ đã chọn.</p></li>`);
  byId("priorityList").innerHTML = priorityItems.join("");
  const importantOrders = [...orders].sort((a,b)=>b.amount-a.amount).slice(0,8);
  byId("ordersTable").innerHTML = importantOrders.length ? importantOrders.map(o => `<tr><td class="code">${esc(o.code)}</td><td class="person-name">${esc(o.customerName)}</td><td>${o.orderDate ? DATE.format(asDate(o.orderDate)) : "—"}</td><td>${esc(o.ownerName)}</td><td><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></td><td class="align-right person-name">${money(o.amount)}</td></tr>`).join("") : emptyRow("Chưa có đơn hàng trong khoảng thời gian này.",6);
  byId("quotesTable").innerHTML = quotes.length ? quotes.slice(0,10).map(q => `<tr><td class="code">${esc(q.code)}</td><td class="person-name">${esc(q.customerName)}</td><td>${q.quoteDate ? DATE.format(asDate(q.quoteDate)) : "—"}</td><td>${esc(q.ownerName)}</td><td>${daysBetween(q.quoteDate)} ngày</td><td class="align-right person-name">${money(q.amount)}</td><td><button class="quote-action" data-quote="${esc(q.code)}">Theo dõi</button></td></tr>`).join("") : emptyRow("Không có báo giá trên 7 triệu đang chờ sinh đơn.",7);
  byId("customersTable").innerHTML = customers.length ? customers.slice(0,10).map(c => `<tr><td class="person-name">${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.ownerName)}</td><td>${c.lastPurchaseDate ? DATE.format(asDate(c.lastPurchaseDate)) : "—"}</td><td><span class="status pending">${daysBetween(c.lastPurchaseDate)} ngày</span></td><td class="align-right">${money(c.totalPurchased)}</td></tr>`).join("") : emptyRow(`Không có khách nào quá ${STALE_DAYS} ngày chưa mua.`,6);
  byId("quoteDataNotice").hidden = state.data.quoteSourceConfigured;
  byId("quoteDataNotice").textContent = "Chưa cấu hình nguồn đọc báo giá tại máy chủ trung gian. Phần cảnh báo sẽ hiển thị sau khi cấu hình QUOTE_API_URL.";
}
function render() {
  const {orders,quotes,customers} = filtered(); const amount = orders.reduce((sum,o)=>sum+o.amount,0); const range=state.range;
  byId("periodDescription").textContent = `Dữ liệu ${range.label.toLowerCase()} · ${DATE.format(asDate(range.from))} – ${DATE.format(asDate(range.to))}`;
  byId("orderCount").textContent = orders.length; byId("orderValue").textContent = money(amount); byId("revenueValue").textContent = money(amount); byId("revenueDetail").textContent = `${orders.length} đơn hàng trong kỳ`;
  byId("quoteCount").textContent = quotes.length; byId("quoteValue").textContent = quotes.length ? money(quotes.reduce((s,q)=>s+q.amount,0)) : "Trên 7.000.000 ₫, chưa sinh đơn";
  byId("staleCustomerCount").textContent = customers.length; byId("staleCustomerRule").textContent = `Từ ${STALE_DAYS} ngày trở lên`;
  byId("navQuoteBadge").textContent=quotes.length; byId("orderTableCount").textContent=`${orders.length} đơn`; byId("quoteTableCount").textContent=`${quotes.length} báo giá`; byId("customerTableCount").textContent=`${customers.length} khách`;
  renderChart(orders); renderTables({orders,quotes,customers});
  const stamp = asDate(state.data.fetchedAt); byId("updatedAt").textContent = `Cập nhật: ${stamp ? stamp.toLocaleString("vi-VN") : "—"}`;
  byId("connectionStatus").textContent = state.config.demo || !state.config.proxyUrl ? "Đang dùng dữ liệu minh hoạ" : "Đã kết nối máy chủ";
  byId("connectionDot").className = `sync-dot ${state.config.demo || !state.config.proxyUrl ? "" : "live"}`;
}
function toast(message) { const el=byId("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove("show"),3200); }
async function load() { const button=byId("refreshButton"); button.disabled=true; button.textContent="Đang tải…"; try { state.data=normalize(await fetchDashboard(state.range)); render(); } catch (error) { toast(error.message + " Đang giữ dữ liệu trước đó."); if (!state.data) { state.config.demo=true; state.data=normalize(await readDemo()); render(); } byId("connectionDot").className="sync-dot error"; } finally { button.disabled=false; button.textContent="↻ Làm mới dữ liệu"; } }
function selectPreset(preset) { state.preset=preset; state.range=getRange(preset); document.querySelectorAll(".preset").forEach(el=>el.classList.toggle("active",el.dataset.preset===preset)); byId("customDates").hidden=preset!=="custom"; if(preset==="custom") { byId("startDate").value=state.range.from; byId("endDate").value=state.range.to; return; } load(); }
function openSettings() { byId("proxyUrl").value=state.config.proxyUrl; byId("demoMode").checked=state.config.demo; byId("settingsDialog").showModal(); }
function saveSettings(event) { event.preventDefault(); state.config={ demo:byId("demoMode").checked, proxyUrl:byId("proxyUrl").value.trim().replace(/\/$/,"") }; localStorage.setItem("amisDashboardConfig",JSON.stringify(state.config)); byId("settingsDialog").close(); load(); toast(state.config.demo ? "Đã chuyển sang dữ liệu minh hoạ." : "Đã lưu máy chủ kết nối AMIS."); }
function bind() { document.querySelectorAll(".preset").forEach(button=>button.addEventListener("click",()=>selectPreset(button.dataset.preset))); byId("applyCustom").addEventListener("click",()=>{const from=byId("startDate").value,to=byId("endDate").value;if(!from||!to||from>to)return toast("Vui lòng chọn khoảng ngày hợp lệ.");state.range={from,to,label:"Khoảng tuỳ chỉnh"};load();}); byId("refreshButton").addEventListener("click",load); byId("openSettings").addEventListener("click",openSettings); byId("openSettingsTop").addEventListener("click",openSettings); byId("saveSettings").addEventListener("click",saveSettings); document.addEventListener("click",event=>{const button=event.target.closest("[data-quote]"); if(button) toast(`Hãy xử lý báo giá ${button.dataset.quote} trong AMIS CRM.`);}); }
document.addEventListener("DOMContentLoaded",()=>{ state.range=getRange(state.preset); bind(); load(); });
