/* ---------- Shanta Shop: what customers see ----------
   Reads the public catalog Shanta publishes (catalog/<product>, shop/settings). Customers sign in with their
   mobile number and an SMS code, then place orders that land in Shanta's Orders page (orders/<id>).
   Products in Egypt go in the order; the rest becomes a request. Down payments are paid by InstaPay and
   the customer uploads a screenshot. Their profile and credit are in customers/<uid>; only the two admins
   can change credit or the down payment a customer is asked for. */
const FB_VER = '13.1.0', FB = s => `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${s}.js`;
const CFG = { apiKey: 'AIzaSyAa9fTvt1RxGFDGf1rWFLBB_gvVlaOkphM', authDomain: 'shanta-dm.firebaseapp.com', projectId: 'shanta-dm' };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const num = v => +v || 0;
const REQ_MAX = 10;
const GICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.7l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
const KORD = '<svg viewBox="0 0 24 24"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7" cy="17.5" r="1.8" fill="currentColor"/><circle cx="17" cy="17.5" r="1.8" fill="currentColor"/></svg>';
const KREQ = '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

/* ---- words ---- */
let LANG = localStorage.getItem('shop-lang') || (/^ar/i.test(navigator.language || '') ? 'ar' : 'en');
const W = {
  en: {
    tag: 'German dm & Rossmann, in Egypt', search: 'Search products or brands', all: 'All', inStock: 'In stock', canReq: 'To request',
    allCats: 'All categories', allBrands: 'All brands', sortName: 'A–Z', sortLow: 'Price: low to high', sortHigh: 'Price: high to low',
    left: n => `Only ${n} left`, avail: 'In stock', way: 'On the way from Germany', soldOut: 'Sold out · you can request it',
    add: 'Add to cart', request: 'Request it', more: 'One more', less: 'One less', nothing: 'No products match.', clear: 'Show all',
    loading: 'Loading products…', loadErr: 'Couldn’t load the shop. Check your internet connection.', retry: 'Try again',
    empty: 'The shop is being stocked. Check back soon.', closed: 'The shop isn’t taking orders right now. You can still look around.',
    cart: 'Your cart', cartEmpty: 'Your cart is empty.', keepShopping: 'Keep shopping', order: 'Order', orderSub: 'In Egypt, delivered to you',
    requests: 'Requests', reqSub: 'Not in Egypt now; we bring them with the next box', reqOnly: n => `${n} in stock, the rest as a request`,
    gone: 'No longer in the shop', remove: 'Remove', close: 'Close', added: 'Added to the cart', requested: 'Added as a request',
    items: n => n === 1 ? '1 item' : `${n} items`, view: 'View cart',
    signin: 'Sign in with your mobile', signinSub: 'We text you a code, or use your Google account. No password.', or: 'or', google: 'Continue with Google', gClosed: 'The Google window closed before signing you in. Try again, or use the SMS code.', phoneNeed: 'Your mobile number, so the courier can reach you.', phone: 'Mobile number', sendCode: 'Send code',
    code: 'Code from the SMS', checkCode: 'Sign in', sentTo: p => `We sent a code to ${p}.`, changeNum: 'Change number', signedAs: p => `Signed in as ${p}`, signout: 'Sign out',
    sending: 'Sending…', checking: 'Checking…',
    details: 'Delivery details', name: 'Name', address: 'Area and address', note: 'Note (optional)',
    payHow: 'How do you want to pay?', cod: 'Cash on delivery', codSub: 'Pay the courier when it arrives', insta: 'InstaPay', instaSub: 'Transfer before delivery',
    goods: 'Products', delivery: 'Delivery', free: 'Free', credit: 'Your credit', total: 'Total', reqTotal: 'Requests total',
    payNow: p => `Pay now by InstaPay (${p}%)`, payLater: 'On delivery', reqDown: p => `Down payment on requests (${p}%)`,
    reqNote: 'You pay the rest of a request when it arrives and you confirm it. You can cancel any time before.',
    place: 'Place order', placing: 'Sending…', need: 'Please fill in your name and address.', needPhone: 'Please enter a mobile number we can reach, e.g. 01012345678.',
    done: 'Thank you! Your order is in.', doneSub: 'Here is what happens next. You can come back to it any time under “My orders” (the person icon at the top).',
    payBox: 'Pay by InstaPay', payTo: 'Send to', amount: 'Amount', ref: 'Write in the transfer note', copy: 'Copy', copied: 'Copied',
    upload: 'Upload the screenshot', uploading: 'Uploading…', proofSent: 'Screenshot sent ✓ We’ll check it.', replace: 'Replace',
    proofOk: 'Screenshot sent', tooBig: 'That picture couldn’t be read. Try a screenshot instead.',
    mine: 'My orders', noOrders: 'No orders yet.', signinMine: 'Sign in to see your orders.', yourCredit: 'Your credit',
    creditNote: 'Comes off your next order automatically.', creditRefund: 'Ask for it as a refund', creditAsked: 'Refund asked. We’ll send it to',
    st: { new: 'Being confirmed', newPay: 'Waiting for your down payment', confirmed: 'Confirmed, being prepared', out: 'Out for delivery', delivered: 'Delivered',
      requested: 'Requested', offered: 'It’s here, please confirm', declined: 'Declined', cancelled: 'Cancelled' },
    paid: 'paid ✓', notPaid: 'not paid yet', checkingPay: 'Checking your payment',
    cancel: 'Cancel order', cancelReq: 'Cancel request', cancelAsk: 'Cancel this order?', cancelAskPaid: a => `Cancel this order? You choose next whether your ${a} comes back to your InstaPay or stays as credit.`, confirmOffer: 'Yes, I still want it', keep: 'Keep it',
    kOrder: 'Order', kOrderSub: 'In stock in Egypt · delivered to you', kReq: 'Request', kReqSub: 'Not in Egypt yet · comes with the next box from Germany',
    together: c => `Placed together with #${c}`,
    shortNow: n => `Sorry, someone just bought the last one: ${n}. Your cart now shows what is left; check it and send again.`,
    payBy: d => `Send it by <b>${d}</b>; after that the order is cancelled and the products go back on sale.`,
    timer: 'Cancelled automatically: the down payment didn’t arrive within 24 hours. You can order again any time.',
    offerGone: 'You didn’t confirm within 24 hours, so the product went back on sale. Your request is still open; we’ll offer it again when more arrive.',
    next: 'What happens next', steps: { sent: 'Sent', pay: 'Down payment', check: 'Payment check', confirmed: 'Confirmed', out: 'On the way', delivered: 'Delivered', requested: 'Requested', arrives: 'Arrives in Egypt', yours: 'You confirm' },
    nx: {
      pay: a => `<b>Send ${a} by InstaPay</b> using the details below, then upload a screenshot of the transfer. We confirm your order as soon as it arrives.`,
      check: '<b>Nothing more to do.</b> We got your screenshot and are checking the transfer, usually within a few hours. Your order is then confirmed here, and we may message you on WhatsApp.',
      confirm: '<b>Nothing to do.</b> We’re checking stock and will confirm your order soon, usually within a few hours.',
      prep: '<b>Your order is confirmed</b> and being packed. We’ll tell you when it leaves.',
      out: '<b>Your order is on the way.</b> The courier will call you before arriving.',
      rest: a => `Pay <b>${a}</b> to the courier, in cash or by InstaPay.`, noRest: 'Everything is paid; there is nothing to pay on delivery.',
      delivered: 'Delivered. Thank you for ordering from us!',
      requested: '<b>We’ll bring it with the next box from Germany.</b> When it arrives we’ll ask you here (and on WhatsApp) to confirm. You pay the rest only then.',
      reqPay: a => `<b>To reserve it, send the ${a} down payment by InstaPay</b> and upload the screenshot below.`,
      reqCheck: '<b>Nothing more to do.</b> We got your screenshot and are checking the down payment. We’ll bring the product with the next box.',
      offered: '<b>It’s here!</b> Tap “Yes, I still want it” within 24 hours and we’ll deliver it like a normal order.',
      cancelled: 'You cancelled this order.', declined: 'We couldn’t fill this order.' },
    refundQ: a => `What should we do with your ${a} down payment?`, refundTo: 'Refund to my InstaPay', refundInput: 'Your InstaPay address or number',
    asCredit: 'Keep as credit', refundChosen: p => `Refund to ${p}`, creditChosen: 'Kept as credit', refundDone: 'Refund sent ✓', creditDone: 'Added to your credit ✓',
    why: 'Message from the shop', wa: 'Questions? WhatsApp us', declinedNote: 'Sorry, we couldn’t fill this one.',
    errs: { phone: 'Check the mobile number.', code: 'That code isn’t right. Check the SMS and try again.', many: 'Too many tries. Wait a few minutes and try again.',
      off: 'Sign-in by SMS isn’t switched on yet. Please message us on WhatsApp.', net: 'No connection. Check your internet and try again.',
      closed: 'The shop isn’t taking orders right now.', gen: 'Something went wrong. Please try again.' }
  },
  ar: {
    tag: 'منتجات dm وRossmann الألمانية، في مصر', search: 'ابحث عن منتج أو ماركة', all: 'الكل', inStock: 'متوفر', canReq: 'بالطلب',
    allCats: 'كل الفئات', allBrands: 'كل الماركات', sortName: 'أ–ي', sortLow: 'السعر: من الأقل', sortHigh: 'السعر: من الأعلى',
    left: n => `متبقٍ ${n} فقط`, avail: 'متوفر', way: 'في الطريق من ألمانيا', soldOut: 'نفد · يمكنك طلبه',
    add: 'أضف إلى السلة', request: 'اطلبه', more: 'واحد زيادة', less: 'واحد أقل', nothing: 'لا توجد منتجات مطابقة.', clear: 'اعرض الكل',
    loading: 'جارٍ تحميل المنتجات…', loadErr: 'تعذّر تحميل المتجر. تحقق من اتصال الإنترنت.', retry: 'حاول مرة أخرى',
    empty: 'نجهّز المتجر الآن. عُد قريبًا.', closed: 'المتجر لا يستقبل طلبات حاليًا. يمكنك التصفح.',
    cart: 'سلتك', cartEmpty: 'سلتك فارغة.', keepShopping: 'تابع التسوق', order: 'الطلب', orderSub: 'موجود في مصر، يصلك بالتوصيل',
    requests: 'طلبات المنتجات', reqSub: 'غير موجود في مصر الآن؛ نحضره مع الشحنة القادمة', reqOnly: n => `${n} متوفر، والباقي كطلب`,
    gone: 'لم يعد في المتجر', remove: 'إزالة', close: 'إغلاق', added: 'أُضيف إلى السلة', requested: 'أُضيف كطلب',
    items: n => n === 1 ? 'منتج واحد' : `${n} منتجات`, view: 'اعرض السلة',
    signin: 'سجّل الدخول برقم موبايلك', signinSub: 'نرسل لك كودًا في رسالة، أو استخدم حساب Google. بدون كلمة سر.', or: 'أو', google: 'المتابعة باستخدام Google', gClosed: 'أُغلقت نافذة Google قبل تسجيل دخولك. حاول مرة أخرى أو استخدم كود الرسالة.', phoneNeed: 'رقم موبايلك ليتواصل معك المندوب.', phone: 'رقم الموبايل', sendCode: 'أرسل الكود',
    code: 'الكود من الرسالة', checkCode: 'تسجيل الدخول', sentTo: p => `أرسلنا كودًا إلى ${p}.`, changeNum: 'غيّر الرقم', signedAs: p => `مسجّل باسم ${p}`, signout: 'تسجيل الخروج',
    sending: 'جارٍ الإرسال…', checking: 'جارٍ التحقق…',
    details: 'بيانات التوصيل', name: 'الاسم', address: 'المنطقة والعنوان', note: 'ملاحظة (اختياري)',
    payHow: 'كيف تحب أن تدفع؟', cod: 'الدفع عند الاستلام', codSub: 'ادفع للمندوب عند الوصول', insta: 'InstaPay', instaSub: 'تحويل قبل التوصيل',
    goods: 'المنتجات', delivery: 'التوصيل', free: 'مجاني', credit: 'رصيدك', total: 'الإجمالي', reqTotal: 'إجمالي الطلبات',
    payNow: p => `ادفع الآن عبر InstaPay (${p}%)`, payLater: 'عند الاستلام', reqDown: p => `عربون طلبات المنتجات (${p}%)`,
    reqNote: 'تدفع باقي ثمن طلب المنتج عند وصوله وتأكيدك له. يمكنك الإلغاء في أي وقت قبل ذلك.',
    place: 'أرسل الطلب', placing: 'جارٍ الإرسال…', need: 'من فضلك اكتب الاسم والعنوان.', needPhone: 'من فضلك اكتب رقم موبايل يمكننا التواصل معك عليه، مثل 01012345678.',
    done: 'شكرًا! وصلنا طلبك.', doneSub: 'هذا ما سيحدث بعد ذلك. يمكنك الرجوع إليه في أي وقت من «طلباتي» (أيقونة الشخص بالأعلى).',
    payBox: 'الدفع عبر InstaPay', payTo: 'حوّل إلى', amount: 'المبلغ', ref: 'اكتب في ملاحظة التحويل', copy: 'نسخ', copied: 'تم النسخ',
    upload: 'ارفع صورة التحويل', uploading: 'جارٍ الرفع…', proofSent: 'تم إرسال الصورة ✓ سنراجعها.', replace: 'استبدال',
    proofOk: 'تم إرسال الصورة', tooBig: 'تعذّرت قراءة الصورة. جرّب لقطة شاشة.',
    mine: 'طلباتي', noOrders: 'لا توجد طلبات بعد.', signinMine: 'سجّل الدخول لترى طلباتك.', yourCredit: 'رصيدك',
    creditNote: 'يُخصم تلقائيًا من طلبك القادم.', creditRefund: 'اطلب استرداده', creditAsked: 'طلبت الاسترداد. سنرسله إلى',
    st: { new: 'في انتظار التأكيد', newPay: 'في انتظار العربون', confirmed: 'تم التأكيد ونجهّزه', out: 'في الطريق إليك', delivered: 'تم التوصيل',
      requested: 'تم الطلب', offered: 'وصل، من فضلك أكّد', declined: 'مرفوض', cancelled: 'ملغي' },
    paid: 'مدفوع ✓', notPaid: 'لم يُدفع بعد', checkingPay: 'نراجع دفعتك',
    cancel: 'إلغاء الطلب', cancelReq: 'إلغاء طلب المنتج', cancelAsk: 'إلغاء هذا الطلب؟', cancelAskPaid: a => `إلغاء هذا الطلب؟ ستختار بعدها هل يعود مبلغ ${a} إلى InstaPay الخاص بك أم يبقى كرصيد.`, confirmOffer: 'نعم، ما زلت أريده', keep: 'احتفظ به',
    kOrder: 'طلب', kOrderSub: 'متوفر في مصر · يصلك بالتوصيل', kReq: 'طلب منتج', kReqSub: 'غير موجود في مصر بعد · يصل مع الشحنة القادمة من ألمانيا',
    together: c => `أُرسل مع الطلب #${c}`,
    shortNow: n => `عذرًا، اشترى شخص آخر آخر قطعة للتو: ${n}. سلتك تعرض الآن المتوفر؛ راجعها وأرسل مرة أخرى.`,
    payBy: d => `حوّل قبل <b>${d}</b>؛ بعدها يُلغى الطلب وتعود المنتجات للبيع.`,
    timer: 'أُلغي تلقائيًا: لم يصل العربون خلال 24 ساعة. يمكنك الطلب مرة أخرى في أي وقت.',
    offerGone: 'لم تؤكد خلال 24 ساعة، فعاد المنتج للبيع. طلبك ما زال مفتوحًا؛ سنعرضه عليك مرة أخرى عند وصول المزيد.',
    next: 'ماذا سيحدث بعد ذلك', steps: { sent: 'أُرسل', pay: 'العربون', check: 'مراجعة الدفع', confirmed: 'تم التأكيد', out: 'في الطريق', delivered: 'تم التوصيل', requested: 'تم الطلب', arrives: 'يصل إلى مصر', yours: 'تؤكد أنت' },
    nx: {
      pay: a => `<b>حوّل ${a} عبر InstaPay</b> باستخدام البيانات بالأسفل، ثم ارفع صورة التحويل. نؤكد طلبك فور وصول المبلغ.`,
      check: '<b>لا شيء مطلوب منك.</b> وصلتنا الصورة ونراجع التحويل، عادةً خلال ساعات قليلة. بعدها يظهر طلبك هنا مؤكدًا، وقد نراسلك على واتساب.',
      confirm: '<b>لا شيء مطلوب منك.</b> نراجع المخزون وسنؤكد طلبك قريبًا، عادةً خلال ساعات قليلة.',
      prep: '<b>تم تأكيد طلبك</b> ونجهّزه الآن. سنخبرك عند خروجه للتوصيل.',
      out: '<b>طلبك في الطريق.</b> سيتصل بك المندوب قبل الوصول.',
      rest: a => `ادفع <b>${a}</b> للمندوب، نقدًا أو عبر InstaPay.`, noRest: 'تم دفع كل شيء؛ لا يوجد ما تدفعه عند الاستلام.',
      delivered: 'تم التوصيل. شكرًا لطلبك منا!',
      requested: '<b>سنحضره مع الشحنة القادمة من ألمانيا.</b> عند وصوله سنطلب منك هنا (وعلى واتساب) أن تؤكد. تدفع الباقي حينها فقط.',
      reqPay: a => `<b>لحجزه، حوّل العربون ${a} عبر InstaPay</b> وارفع صورة التحويل بالأسفل.`,
      reqCheck: '<b>لا شيء مطلوب منك.</b> وصلتنا الصورة ونراجع العربون. سنحضر المنتج مع الشحنة القادمة.',
      offered: '<b>وصل!</b> اضغط «نعم، ما زلت أريده» خلال 24 ساعة وسنوصله لك كطلب عادي.',
      cancelled: 'ألغيت هذا الطلب.', declined: 'لم نتمكن من تنفيذ هذا الطلب.' },
    refundQ: a => `ماذا نفعل بعربونك (${a})؟`, refundTo: 'استرداد إلى InstaPay الخاص بي', refundInput: 'عنوان أو رقم InstaPay الخاص بك',
    asCredit: 'احتفظ به كرصيد', refundChosen: p => `استرداد إلى ${p}`, creditChosen: 'محفوظ كرصيد', refundDone: 'تم الاسترداد ✓', creditDone: 'أُضيف إلى رصيدك ✓',
    why: 'رسالة من المتجر', wa: 'أسئلة؟ راسلنا على واتساب', declinedNote: 'نعتذر، لم نتمكن من تنفيذ هذا الطلب.',
    errs: { phone: 'تحقق من رقم الموبايل.', code: 'الكود غير صحيح. راجع الرسالة وحاول مرة أخرى.', many: 'محاولات كثيرة. انتظر بضع دقائق وحاول مرة أخرى.',
      off: 'تسجيل الدخول بالرسائل غير مفعّل بعد. راسلنا على واتساب من فضلك.', net: 'لا يوجد اتصال. تحقق من الإنترنت وحاول مرة أخرى.',
      closed: 'المتجر لا يستقبل طلبات حاليًا.', gen: 'حدث خطأ. حاول مرة أخرى.' }
  }
};
const t = (k, ...a) => { const v = W[LANG][k] ?? W.en[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
const money = n => LANG === 'ar' ? `${Math.round(n).toLocaleString('en-US')} ج.م` : `EGP ${Math.round(n).toLocaleString('en-US')}`;
const when = iso => iso ? new Date(iso).toLocaleString(LANG === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
/* the order server cancels an unpaid order at this time (same rule as shop-worker.js): 24 h after ordering, or 48 h after the offer for a request that arrived */
const payDeadline = o => Date.parse(o.offeredAt || o.createdAt) + (o.offeredAt ? 48 : 24) * 36e5;

/* ---- state ---- */
let CAT = [], BY = {}, SET = { name: 'Shanta', reqDownPct: 20, downCod: 0, downInsta: 100, deliveryFee: 0, open: true, lowStock: 2 }, STATE = 'loading';
const CART = ls('shop-cart', {});           // product id → units
const ME = ls('shop-me', {});               // name, address, note, method
const UI = { q: '', avail: '', cat: '', brand: '', sort: 'name' };
const P = { mode: '', busy: '', err: '', phone: '', conf: null, placed: [], cancelling: '', refundFor: '', creditAsk: false };
let FBX = null, USER = null, CUST = null, MINE = [], unsub = [];

async function fbx() {
  if (FBX) return FBX;
  const [A, U, S] = await Promise.all([import(FB('app')), import(FB('auth')), import(FB('firestore'))]);
  /* its own app name: signing in or out here never touches Shanta's admin login on the same site */
  const app = A.getApps().find(a => a.name === 'shop') || A.initializeApp(CFG, 'shop');
  const auth = U.getAuth(app); auth.languageCode = LANG;
  FBX = { U, S, app, auth, fs: S.getFirestore(app) };
  U.onAuthStateChanged(auth, u => { USER = u; listen(); draw(); });
  return FBX;
}
/* units in Egypt minus units held by open orders; older catalogs only have the final number */
function stockOf(p) {
  if (p.eg !== undefined) { p.avail = Math.max(0, num(p.eg) - num(p.held)); p.status = p.avail > 0 ? 'in' : num(p.way) > 0 ? 'way' : 'request'; }
  return p;
}
async function load() {
  STATE = 'loading'; draw();
  try {
    const { S, fs } = await fbx();
    const [cat, st] = await Promise.all([S.getDocs(S.collection(fs, 'catalog')), S.getDoc(S.doc(fs, 'shop', 'settings'))]);
    CAT = []; cat.forEach(d => CAT.push(stockOf(Object.assign({ id: d.id }, d.data()))));
    BY = {}; CAT.forEach(p => BY[p.id] = p);
    if (st.exists()) SET = Object.assign(SET, st.data());
    STATE = 'ok';
  } catch (e) { console.warn(e); STATE = 'error'; }
  draw();
}
/* the signed-in customer's profile and orders, live */
function listen() {
  unsub.forEach(u => u()); unsub = []; CUST = null; MINE = [];
  if (!USER) return;
  const { S, fs } = FBX;
  unsub.push(S.onSnapshot(S.doc(fs, 'customers', USER.uid), d => { CUST = d.exists() ? d.data() : null;
    if (CUST) { ['name', 'address'].forEach(k => { if (!ME[k] && CUST[k]) ME[k] = CUST[k]; }); if (!ME.phone && CUST.phone) ME.phone = CUST.phone.replace(/^[+]20/, '0'); save('shop-me', ME); } draw(); }, e => console.warn(e)));
  unsub.push(S.onSnapshot(S.query(S.collection(fs, 'orders'), S.where('uid', '==', USER.uid)), q => {
    MINE = q.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); draw(); }, e => console.warn(e)));
}

/* ---- cart: units in Egypt go in the order, the rest is a request ---- */
const maxFor = p => p.status === 'in' ? (p.avail | 0) + REQ_MAX : REQ_MAX;   // beyond the stock in Egypt, the extra units are requested
const pctOf = (v, d) => { const c = CUST && CUST.downPct; return c !== undefined && c !== null && c !== '' ? num(c) : num(v ?? d); };
const downOf = (total, pct) => pct >= 100 ? total : Math.min(total, Math.ceil(total * pct / 100 / 5) * 5);
function lines() {
  const o = [], r = [], gone = [];
  Object.entries(CART).forEach(([id, q]) => {
    const p = BY[id]; q = q | 0; if (q <= 0) return;
    if (!p) { gone.push(id); return; }
    const ord = p.status === 'in' ? Math.min(q, p.avail | 0) : 0;
    if (ord) o.push({ p, q: ord });
    if (q - ord) r.push({ p, q: q - ord, split: ord > 0 });
  });
  const sum = a => a.reduce((s, x) => s + x.q * num(x.p.price), 0);
  const method = SET.instapay && ME.method === 'instapay' ? 'instapay' : 'cod';
  const fee = num(SET.deliveryFee), credit = Math.max(0, num(CUST && CUST.credit));
  /* delivery and credit go on the order; on the request when there are only requests */
  const og = sum(o), rg = sum(r), od = o.length ? fee : 0, rd = !o.length && r.length ? fee : 0;
  const oc = Math.min(credit, og + od), rc = o.length ? 0 : Math.min(credit, rg + rd);
  const ot = og + od - oc, rt = rg + rd - rc;
  const opct = pctOf(method === 'cod' ? SET.downCod : SET.downInsta, method === 'cod' ? 0 : 100), rpct = pctOf(SET.reqDownPct, 20);
  return { o, r, gone, method, og, rg, od, rd, oc, rc, ot, rt, opct, rpct, odown: downOf(ot, opct), rdown: downOf(rt, rpct), n: Object.values(CART).reduce((s, q) => s + (q | 0), 0) };
}
function setQty(id, q) {
  const p = BY[id]; q = Math.max(0, Math.min(q | 0, p ? maxFor(p) : 0));
  if (q) CART[id] = q; else delete CART[id];
  save('shop-cart', CART);
}

/* ---- products ---- */
const initials = p => esc(String(p.brand || p.name || '?').trim().slice(0, 2).toUpperCase());
const stockLine = p => p.status === 'in' ? ((p.avail | 0) <= (num(SET.lowStock) || 2) ? `<span class="st low">${t('left', p.avail | 0)}</span>` : `<span class="st ok">${t('avail')}</span>`)
  : p.status === 'way' ? `<span class="st way">${t('way')}</span>` : `<span class="st req">${t('soldOut')}</span>`;
function stepper(p) {
  const q = CART[p.id] | 0;
  if (!q) return p.status === 'in' ? `<button type="button" class="btn" data-add="${esc(p.id)}">${t('add')}</button>` : `<button type="button" class="btn req" data-add="${esc(p.id)}">${t('request')}</button>`;
  return `<div class="step"><button type="button" data-q="${esc(p.id)}:-1" aria-label="${t('less')}">−</button><b>${q}</b><button type="button" data-q="${esc(p.id)}:1" aria-label="${t('more')}"${q >= maxFor(p) ? ' disabled' : ''}>+</button></div>`;
}
function card(p) {
  return `<article class="pc" data-id="${esc(p.id)}">
    <div class="ph">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ini',textContent:this.dataset.i}))" data-i="${initials(p)}">` : `<span class="ini">${initials(p)}</span>`}
      <span class="stag ${p.store === 'Rossmann' ? 'ross' : 'dm'}">${esc(p.store || 'dm')}</span></div>
    <div class="pb"><small><bdi>${esc(p.brand || '')}</bdi></small><h3><bdi>${esc(p.name)}</bdi></h3>
      <div class="pr"><b>${money(num(p.price))}</b>${p.size ? `<span dir="ltr">${esc(p.size)}</span>` : ''}</div>
      ${stockLine(p)}${stepper(p)}</div></article>`;
}
function filtersHTML() {
  const uniq = k => [...new Set(CAT.map(p => String(p[k] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
  const chip = (v, l) => `<button type="button" class="chip${UI.avail === v ? ' on' : ''}" data-avail="${v}">${l}</button>`;
  const cats = uniq('category'), brands = uniq('brand');
  return `<input type="search" id="q" value="${esc(UI.q)}" placeholder="${t('search')}" autocomplete="off">
    <div class="frow">${chip('', t('all'))}${chip('in', t('inStock'))}${chip('req', t('canReq'))}
      ${cats.length > 1 ? `<select data-f="cat">${opt('', t('allCats'), UI.cat)}${cats.map(c => opt(c, c, UI.cat)).join('')}</select>` : ''}
      ${brands.length > 1 ? `<select data-f="brand">${opt('', t('allBrands'), UI.brand)}${brands.map(c => opt(c, c, UI.brand)).join('')}</select>` : ''}
      <select data-f="sort">${opt('name', t('sortName'), UI.sort)}${opt('low', t('sortLow'), UI.sort)}${opt('high', t('sortHigh'), UI.sort)}</select></div>`;
}
function shown() {
  const q = UI.q.trim().toLowerCase(), rank = p => p.status === 'in' ? 0 : p.status === 'way' ? 1 : 2;
  return CAT.filter(p => (!q || `${p.name} ${p.brand} ${p.category} ${p.ean}`.toLowerCase().includes(q))
    && (!UI.avail || (UI.avail === 'in' ? p.status === 'in' : p.status !== 'in'))
    && (!UI.cat || p.category === UI.cat) && (!UI.brand || p.brand === UI.brand))
    .sort((a, b) => UI.sort === 'low' ? a.price - b.price : UI.sort === 'high' ? b.price - a.price : rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
}
function drawGrid() {
  const g = $('#grid');
  if (STATE === 'loading') { g.innerHTML = `<p class="msg"><span class="spin"></span>${t('loading')}</p>`; return; }
  if (STATE === 'error') { g.innerHTML = `<p class="msg">${t('loadErr')}<br><button type="button" class="btn ghost" data-act="retry">${t('retry')}</button></p>`; return; }
  if (!CAT.length) { g.innerHTML = `<p class="msg">${t('empty')}</p>`; return; }
  g.innerHTML = shown().map(card).join('') || `<p class="msg">${t('nothing')}<br><button type="button" class="btn ghost" data-act="clear">${t('clear')}</button></p>`;
}
const openFor = o => ['new', 'requested', 'offered'].includes(o.status);
const mineNeeds = () => MINE.filter(o => o.status === 'offered' || (openFor(o) && num(o.down) > 0 && !o.downPaid && !o.proof)
  || (['declined', 'cancelled'].includes(o.status) && (o.downPaid || o.proof) && num(o.down) > 0 && !o.refund && !o.refundDone)).length;
function drawBar() {
  const L = lines(), b = $('#cartbar');
  $('#cartn').textContent = L.n || ''; $('#cartn').hidden = !L.n;
  const n = mineNeeds(); $('#men').textContent = n || ''; $('#men').hidden = !n;
  b.innerHTML = L.n && P.mode !== 'cart' ? `<button type="button" class="cb" data-act="cart"><span>${t('items', L.n)}</span><b>${money(L.og + L.rg)}</b><span class="go">${t('view')}</span></button>` : '';
  document.body.classList.toggle('hasbar', !!L.n && P.mode !== 'cart');
}

/* ---- the panel: cart & checkout, order sent, my orders ---- */
const waLink = () => SET.whatsapp ? `<a class="walink" href="https://wa.me/${esc(SET.whatsapp)}" target="_blank" rel="noopener">${t('wa')}</a>` : '';
const head = title => `<div class="dh"><h2>${title}</h2><button type="button" class="x" data-act="close" aria-label="${t('close')}">×</button></div>`;
const errHTML = () => P.err ? `<p class="err">${esc(P.err)}</p>` : '';
function lineHTML(x) {
  return `<li><div class="li"><b><bdi>${esc(x.p.name)}</bdi></b><small>${x.p.brand ? `<bdi>${esc(x.p.brand)}</bdi> · ` : ''}<bdi>${money(num(x.p.price))}</bdi>${x.split ? `<span class="split">${t('reqOnly', x.p.avail | 0)}</span>` : ''}</small></div>
    ${x.split ? `<b class="lq">× ${x.q}</b>` : `<div class="step sm"><button type="button" data-q="${esc(x.p.id)}:-1" aria-label="${t('less')}">−</button><b>${x.q}</b><button type="button" data-q="${esc(x.p.id)}:1" aria-label="${t('more')}"${(CART[x.p.id] | 0) >= maxFor(x.p) ? ' disabled' : ''}>+</button></div>`}
    <b class="lt">${money(x.q * num(x.p.price))}</b></li>`;
}
const row = (l, v, cls) => `<p class="tot${cls ? ' ' + cls : ''}"><span>${l}</span><b>${v}</b></p>`;
function signinHTML() {
  if (USER) return `<p class="signed">${t('signedAs', `<span dir="ltr">${esc(USER.phoneNumber || USER.email || '')}</span>`)} <button type="button" class="linkbtn" data-act="signout">${t('signout')}</button></p>`;
  if (P.conf) return `<section><h3>${t('signin')}</h3><p class="note">${t('sentTo', `<span dir="ltr">${esc(P.phone)}</span>`)} <button type="button" class="linkbtn" data-act="renum">${t('changeNum')}</button></p>
    <div class="inrow"><input id="codein" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="${t('code')}" dir="ltr"><button type="button" class="btn" data-act="code"${P.busy ? ' disabled' : ''}>${P.busy === 'code' ? t('checking') : t('checkCode')}</button></div>${errHTML()}</section>`;
  return `<section><h3>${t('signin')}<small>${t('signinSub')}</small></h3>
    <div class="inrow"><input id="phonein" type="tel" inputmode="tel" autocomplete="tel" placeholder="01012345678" value="${esc(P.phone)}" dir="ltr"><button type="button" class="btn" id="sendcode" data-act="send"${P.busy ? ' disabled' : ''}>${P.busy === 'send' ? t('sending') : t('sendCode')}</button></div>${errHTML()}
    <div class="or"><span>${t('or')}</span></div>
    ${P.busy === 'google' ? `<p class="note gwait"><span class="spin"></span>${t('checking')}</p>` : SET.googleClientId ? '<div id="gsi" class="gsi"></div>' : `<button type="button" class="gbtn" data-act="google"${P.busy ? ' disabled' : ''}>${GICON}${t('google')}</button>`}</section>`;
}
function cartHTML() {
  const L = lines(), open = SET.open !== false;
  if (!L.n) return head(t('cart')) + `<p class="msg">${t('cartEmpty')}</p><button type="button" class="btn full" data-act="close">${t('keepShopping')}</button>` + waLink();
  const f = (k, l, type, extra) => `<label class="fl"><span>${l}</span><input data-me="${k}" type="${type}" value="${esc(ME[k] || '')}" ${extra || ''}></label>`;
  const m = (v, l, s) => `<label class="pm${L.method === v ? ' on' : ''}"><input type="radio" name="pm" data-method="${v}"${L.method === v ? ' checked' : ''}><span><b>${l}</b><small>${s}</small></span></label>`;
  return head(t('cart')) + `
    ${L.o.length ? `<section><h3>${t('order')}<small>${t('orderSub')}</small></h3><ul class="cl">${L.o.map(lineHTML).join('')}</ul></section>` : ''}
    ${L.r.length ? `<section class="rq"><h3>${t('requests')}<small>${t('reqSub')}</small></h3><ul class="cl">${L.r.map(lineHTML).join('')}</ul></section>` : ''}
    ${L.gone.length ? `<p class="note">${t('gone')}: ${L.gone.length} <button type="button" class="linkbtn" data-act="dropgone">${t('remove')}</button></p>` : ''}
    ${signinHTML()}
    ${USER ? `<section><h3>${t('details')}</h3><div class="fg">${f('name', t('name'), 'text', 'autocomplete="name"')}${USER.phoneNumber ? '' : f('phone', t('phone'), 'tel', 'autocomplete="tel" inputmode="tel" dir="ltr" placeholder="01012345678"')}${f('address', t('address'), 'text', 'autocomplete="street-address"')}${f('note', t('note'), 'text')}</div></section>
    ${L.o.length && SET.instapay ? `<section><h3>${t('payHow')}</h3><div class="pms">${m('cod', t('cod'), t('codSub'))}${m('instapay', t('insta'), t('instaSub'))}</div></section>` : ''}
    <section class="sum">
      ${L.o.length ? row(t('goods'), money(L.og)) + row(t('delivery'), L.od ? money(L.od) : t('free')) + (L.oc ? row(t('credit'), '−' + money(L.oc)) : '') + row(t('total'), money(L.ot), 'big')
        + (L.odown > 0 ? row(t('payNow', L.opct), money(L.odown), 'down') + (L.ot - L.odown > 0 ? row(t('payLater'), money(L.ot - L.odown)) : '') : '') : ''}
      ${L.r.length ? (L.o.length ? '<hr>' : '') + row(t('reqTotal'), money(L.rg)) + (L.rd ? row(t('delivery'), money(L.rd)) : '') + (L.rc ? row(t('credit'), '−' + money(L.rc)) : '')
        + (L.rdown > 0 ? row(t('reqDown', L.rpct), money(L.rdown), 'down') : '') + `<p class="note">${t('reqNote')}</p>` : ''}
    </section>
    ${P.err && USER ? errHTML() : ''}
    ${open ? `<button type="button" class="btn full big" data-act="place"${P.busy ? ' disabled' : ''}>${P.busy === 'place' ? t('placing') : t('place')}</button>` : `<p class="banner">${t('closed')}</p>`}` : ''}
    ${waLink()}`;
}
function payBox(o) {
  if (!(num(o.down) > 0) || o.downPaid || !openFor(o)) return '';
  if (o.proof) return `<p class="ok proofok">${t('proofSent')} <button type="button" class="linkbtn" data-proof="${esc(o.id)}">${t('replace')}</button></p>`;
  const cp = (v, l) => `<div class="cp"><small>${l}</small><b dir="ltr">${esc(v)}</b><button type="button" class="linkbtn" data-copy="${esc(v)}">${t('copy')}</button></div>`;
  return `<div class="paybox"><h4>${t('payBox')}</h4>${SET.instapay ? cp(SET.instapay, t('payTo')) : ''}${cp(String(Math.round(num(o.down))), t('amount') + ' (EGP)')}${cp('#' + o.code, t('ref'))}
    <button type="button" class="btn full" data-proof="${esc(o.id)}"${P.busy === 'proof:' + o.id ? ' disabled' : ''}>${P.busy === 'proof:' + o.id ? t('uploading') : t('upload')}</button></div>`;
}
/* where the order is, as steps: done, now (the customer acts), wait (we act), later (not reached yet).
   The down payment steps only show when there is one */
function stepsOf(o) {
  const S = W[LANG].steps, dp = num(o.down) > 0, st = o.status, paid = !!o.downPaid, sent = paid || !!o.proof;
  const ready = !dp || paid;
  const at = {
    sent: 'done', requested: 'done',
    pay: sent ? 'done' : 'now',
    check: paid ? 'done' : o.proof ? 'wait' : 'later',
    confirmed: ['confirmed', 'out', 'delivered'].includes(st) ? 'done' : st === 'new' && ready ? 'wait' : 'later',
    out: st === 'delivered' ? 'done' : st === 'out' ? 'now' : 'later',
    delivered: st === 'delivered' ? 'done' : 'later',
    arrives: st === 'offered' ? 'done' : st === 'requested' && ready ? 'wait' : 'later',
    yours: st === 'offered' ? 'now' : 'later'
  };
  const keys = o.kind === 'request' && st !== 'new' && !['confirmed', 'out', 'delivered'].includes(st)
    ? ['requested', ...(dp ? ['pay'] : []), 'arrives', 'yours']
    : ['sent', ...(dp ? ['pay', 'check'] : []), 'confirmed', 'out', 'delivered'];
  return keys.map(k => [S[k], at[k]]);
}
/* one short paragraph: what the customer does now, or that there is nothing to do */
function nextOf(o) {
  const N = W[LANG].nx, dp = num(o.down) > 0, due = money(num(o.down));
  const rest = Math.max(0, num(o.total) - (o.downPaid ? num(o.down) : 0));
  const pay = rest > 0 ? N.rest(money(rest)) : N.noRest;
  if (o.status === 'cancelled') return o.cancelledBy === 'timer' ? t('timer') : N.cancelled;
  if (o.status === 'declined') return N.declined + (o.declineMsg ? ` ${t('why')}: “${esc(o.declineMsg)}”` : '');
  if (o.status === 'delivered') return N.delivered;
  if (o.status === 'offered') return N.offered;
  if (o.status === 'requested') return (o.offerExpired ? t('offerGone') + ' ' : '') + (dp && !o.downPaid ? (o.proof ? N.reqCheck : N.reqPay(due)) : N.requested);
  if (o.status === 'out') return `${N.out} ${pay}`;
  if (o.status === 'confirmed') return `${N.prep} ${pay}`;
  if (dp && !o.downPaid) return o.proof ? N.check : N.pay(due) + (o.holding && o.createdAt ? ' ' + t('payBy', when(new Date(payDeadline(o)).toISOString())) : '');
  return `${N.confirm} ${pay}`;
}
function orderHTML(o) {
  const S = W[LANG].st, label = o.status === 'new' && num(o.down) > 0 && !o.downPaid ? (o.proof ? t('checkingPay') : S.newPay) : S[o.status] || o.status;
  const cls = { new: 'warn', offered: 'warn', confirmed: 'ok', out: 'ok', delivered: 'ok', declined: 'bad', cancelled: 'bad', requested: '' }[o.status] || '';
  const back = (o.downPaid || o.proof) ? num(o.down) : 0, closed = ['declined', 'cancelled'].includes(o.status);
  let refund = '';
  const choose = `<p class="note"><b>${t('refundQ', money(back))}</b></p><div class="inrow"><input id="refto-${esc(o.id)}" placeholder="${t('refundInput')}" dir="ltr" value="${esc(ME.instapay || '')}"><button type="button" class="btn" data-mine="${P.cancelling === o.id ? 'cxrefund' : 'refund'}:${o.id}">${t('refundTo')}</button></div>
    <button type="button" class="btn ghost full" data-mine="${P.cancelling === o.id ? 'cxcredit' : 'credit'}:${o.id}">${t('asCredit')}</button>`;
  if (P.cancelling === o.id) refund = back ? `<div class="refbox">${choose}<button type="button" class="linkbtn" data-mine="nocx:${o.id}">${t('keep')}</button></div>` : '';
  else if (closed && back) refund = `<div class="refbox">${o.refundDone ? `<p class="ok">${o.refund === 'credit' ? t('creditDone') : t('refundDone')}</p>`
    : o.refund ? `<p class="note">${o.refund === 'credit' ? t('creditChosen') : t('refundChosen', `<span dir="ltr">${esc(o.refundTo || '')}</span>`)}</p>` : choose}</div>`;
  const steps = closed ? '' : `<ol class="steps">${stepsOf(o).map(([l, s]) => `<li class="${s}"><i></i><span>${l}</span></li>`).join('')}</ol>`;
  const take = o.status === 'offered' ? `<button type="button" class="btn full" data-mine="take:${o.id}">${t('confirmOffer')}</button>` : '';
  const cancel = openFor(o) && P.cancelling !== o.id ? `<button type="button" class="linkbtn cxl" data-mine="cancel:${o.id}">${o.kind === 'request' ? t('cancelReq') : t('cancel')}</button>` : '';
  const req = o.kind === 'request', mate = o.group && [...MINE, ...P.placed].find(x => x.group === o.group && x.id !== o.id);
  const kind = `<div class="kind"><span class="kic" aria-hidden="true">${req ? KREQ : KORD}</span><span><b>${req ? t('kReq') : t('kOrder')}</b><small>${req ? t('kReqSub') : t('kOrderSub')}</small></span></div>`;
  return `<article class="mo ${req ? 'isreq' : 'isord'}">${kind}<div class="moh"><b>#${esc(o.code)}</b><span class="pill ${cls}">${label}</span></div><small class="sub">${when(o.createdAt)}${mate ? ` · ${t('together', esc(mate.code))}` : ''}</small>
    ${steps}
    <div class="next ${closed ? 'closed' : ''}">${closed ? '' : `<small>${t('next')}</small>`}<p>${nextOf(o)}</p></div>
    ${take}${payBox(o)}${refund}
    <details class="mod"${o.status === 'delivered' || closed ? '' : ' open'}><summary>${t('items', (o.lines || []).reduce((a, l) => a + num(l.qty), 0))} · ${money(num(o.total))}</summary>
    <ul class="cl">${(o.lines || []).map(l => `<li><div class="li"><b>${num(l.qty)} × <bdi>${esc(l.name)}</bdi></b><small><bdi>${esc(l.brand || '')}</bdi></small></div><b class="lt">${money(num(l.qty) * num(l.price))}</b></li>`).join('')}</ul>
    ${num(o.delivery) ? row(t('delivery'), money(num(o.delivery))) : ''}${num(o.creditUsed) ? row(t('credit'), '−' + money(num(o.creditUsed))) : ''}${row(t('total'), money(num(o.total)), 'big')}
    ${num(o.down) > 0 ? row(o.kind === 'request' ? t('reqDown', num(o.downPct)) : t('payNow', num(o.downPct)), `${money(num(o.down))} · ${o.downPaid ? t('paid') : o.proof ? t('checkingPay') : t('notPaid')}`, 'down') : ''}</details>
    ${cancel}</article>`;
}
function doneHTML() {
  const list = P.placed.map(p => MINE.find(o => o.id === p.id) || p);
  return head(t('done')) + `<p class="note">${t('doneSub')}</p>${errHTML()}${list.map(orderHTML).join('')}
    <button type="button" class="btn ghost full" data-act="close">${t('keepShopping')}</button>${waLink()}`;
}
function mineHTML() {
  if (!USER) return head(t('mine')) + `<p class="note">${t('signinMine')}</p>` + signinHTML() + waLink();
  const c = num(CUST && CUST.credit), asked = CUST && CUST.creditRefundAt && (!CUST.creditRefundDoneAt || CUST.creditRefundDoneAt < CUST.creditRefundAt);
  return head(t('mine')) + signinHTML()
    + (c > 0 ? `<section class="credit"><p class="tot big"><span>${t('yourCredit')}</span><b>${money(c)}</b></p><p class="note">${t('creditNote')}</p>
      ${asked ? `<p class="note">${t('creditAsked')} <span dir="ltr">${esc(CUST.creditRefundTo || '')}</span></p>`
        : P.creditAsk ? `<div class="inrow"><input id="credto" placeholder="${t('refundInput')}" dir="ltr" value="${esc(ME.instapay || '')}"><button type="button" class="btn" data-mine="credref:">${t('refundTo')}</button></div>`
        : `<button type="button" class="linkbtn" data-mine="credask:">${t('creditRefund')}</button>`}</section>` : '')
    + errHTML() + (MINE.length ? MINE.map(orderHTML).join('') : `<p class="msg">${t('noOrders')}</p>`) + waLink();
}
function drawPanel() {
  const p = $('#panel');
  if (!P.mode) { if (!p.hidden) { p.hidden = true; document.body.classList.remove('locked'); } return; }
  const keep = document.activeElement && document.activeElement.id && p.contains(document.activeElement) ? [document.activeElement.id, document.activeElement.selectionStart] : null;
  const keepMe = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.me;
  const sc = $('.sheet').scrollTop;
  $('#pbody').innerHTML = P.mode === 'cart' ? cartHTML() : P.mode === 'done' ? doneHTML() : mineHTML();
  p.hidden = false; document.body.classList.add('locked'); $('.sheet').scrollTop = sc;
  const el = keep ? document.getElementById(keep[0]) : keepMe ? $(`[data-me="${keepMe}"]`) : null;
  if (el) { el.focus(); try { el.setSelectionRange(keep ? keep[1] : el.value.length, keep ? keep[1] : el.value.length); } catch (e) { } }
  mountGsi();
}
function draw() {
  document.documentElement.lang = LANG; document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  $('#langbtn').textContent = LANG === 'ar' ? 'English' : 'العربية';
  $('#sname').textContent = SET.name || 'Shanta'; $('#stag').textContent = t('tag');
  document.title = (SET.name || 'Shanta') + (LANG === 'ar' ? ' · المتجر' : ' Shop');
  if (STATE === 'ok' && CAT.length) { const had = document.activeElement && document.activeElement.id === 'q'; $('#filters').innerHTML = filtersHTML(); if (had) { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  else $('#filters').innerHTML = '';
  $('#banner').innerHTML = STATE === 'ok' && SET.open === false ? `<p class="banner">${t('closed')}</p>` : '';
  drawGrid(); drawBar(); drawPanel();
}
function toast(m) { const e = $('#toast'); e.textContent = m; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2400); }
const errMsg = e => { const c = (e && e.code) || '', E = W[LANG].errs;
  return /invalid-phone|missing-phone/.test(c) ? E.phone : /invalid-verification-code|code-expired|missing-code/.test(c) ? E.code : /too-many|quota/.test(c) ? E.many
    : /operation-not-allowed|billing|admin-restricted|region/.test(c) ? E.off : /network|unavailable/.test(c) ? E.net : /permission/.test(c) && SET.open === false ? E.closed : E.gen; };

/* ---- sign in with an SMS code ---- */
const e164 = v => { const raw = String(v || '').trim(), d = raw.replace(/\D/g, '');
  if (/^01\d{9}$/.test(d)) return '+2' + d;
  if (/^1\d{9}$/.test(d)) return '+20' + d;
  if (raw.startsWith('+')) return '+' + d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  return d.length >= 11 ? '+' + d : ''; };
async function sendCode() {
  const ph = e164($('#phonein').value); P.phone = $('#phonein').value.trim();
  if (!ph || ph.length < 11) { P.err = t('errs').phone; return drawPanel(); }
  P.busy = 'send'; P.err = ''; drawPanel();
  try {
    const { U, auth } = await fbx(); auth.languageCode = LANG;
    if (!sendCode.v) sendCode.v = new U.RecaptchaVerifier(auth, 'recap', { size: 'invisible' });
    P.conf = await U.signInWithPhoneNumber(auth, ph, sendCode.v); P.phone = ph;
  } catch (e) { console.warn(e); P.err = errMsg(e); try { sendCode.v && sendCode.v.clear(); } catch (x) { } sendCode.v = null; $('#recap').innerHTML = ''; }
  P.busy = ''; drawPanel(); const c = $('#codein'); if (c) c.focus();
}
/* Google: free, but the phone number is typed in at checkout, not checked */
/* Google's own button (Google Identity Services): the account comes straight back to this page as a token,
   so it works even where the browser blocks the Firebase sign-in window from passing the result back */
const gsiLoad = () => gsiLoad.p || (gsiLoad.p = new Promise((ok, no) => { const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = () => { gsiLoad.p = null; no(new Error('gsi')); }; document.head.appendChild(s); }));
async function mountGsi() {
  const el = $('#gsi'); if (!el || !SET.googleClientId) return;
  try { await gsiLoad(); } catch (e) { el.innerHTML = `<button type="button" class="gbtn" data-act="google">${GICON}${t('google')}</button>`; return; }
  const id = window.google.accounts.id;
  if (mountGsi.cid !== SET.googleClientId) { mountGsi.cid = SET.googleClientId;
    id.initialize({ client_id: SET.googleClientId, callback: gsiDone, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true, use_fedcm_for_button: true }); }
  if (!document.body.contains(el)) return;
  id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'center', locale: LANG, width: Math.min(400, Math.max(200, el.clientWidth || 300)) });
}
async function gsiDone(r) {
  P.busy = 'google'; P.err = ''; drawPanel();
  try { const { U, auth } = await fbx(); await U.signInWithCredential(auth, U.GoogleAuthProvider.credential(r.credential)); }
  catch (e) { console.warn(e); P.err = errMsg(e); }
  P.busy = ''; draw();
}
async function googlePopup() {
  P.busy = 'google'; P.err = ''; drawPanel();
  try { const { U, auth } = await fbx(); const pr = new U.GoogleAuthProvider(); pr.setCustomParameters({ prompt: 'select_account' });
    try { await U.signInWithPopup(auth, pr); }
    catch (e) { if (/popup-blocked|operation-not-supported/.test(e && e.code || '')) return U.signInWithRedirect(auth, pr); throw e; } }
  catch (e) { console.warn(e); P.err = /popup-closed|cancelled-popup/.test(e && e.code || '') ? t('gClosed') : errMsg(e); }
  P.busy = ''; draw();
}
async function checkCode() {
  const c = ($('#codein').value || '').replace(/\D/g, ''); if (c.length < 6) { P.err = t('errs').code; return drawPanel(); }
  P.busy = 'code'; P.err = ''; drawPanel();
  try { await P.conf.confirm(c); P.conf = null; } catch (e) { console.warn(e); P.err = errMsg(e); }
  P.busy = ''; draw();
}

/* ---- placing the order ---- */
const CODE_CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => CODE_CH[b % CODE_CH.length]).join('');
const pack = a => a.map(x => ({ id: x.p.id, name: x.p.name, brand: x.p.brand || '', ean: x.p.ean || '', price: num(x.p.price), qty: x.q }));
/* with the order server switched on (shop settings: orderApi), the server checks the stock, works out
   prices, down payment and credit, holds the units and writes the orders, all in one step */
async function placeViaServer(L, phone) {
  const tok = await USER.getIdToken();
  const want = {};
  L.o.forEach(x => (want[x.p.id] = want[x.p.id] || { id: x.p.id, qty: 0, now: 0 }, want[x.p.id].qty += x.q, want[x.p.id].now += x.q));
  L.r.forEach(x => (want[x.p.id] = want[x.p.id] || { id: x.p.id, qty: 0, now: 0 }, want[x.p.id].qty += x.q));
  const r = await fetch(SET.orderApi.replace(/\/+$/, '') + '/order', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
    body: JSON.stringify({ lines: Object.values(want), method: L.method, phone, name: ME.name.trim(), address: ME.address.trim(), note: String(ME.note || '').trim(), lang: LANG }) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 409 && (d.short || d.gone)) {
    /* someone else just bought it: show the real stock and let the customer look again */
    (d.short || []).forEach(s => { const p = BY[s.id]; if (p) { p.avail = s.avail; p.status = s.avail > 0 ? 'in' : num(p.way) > 0 ? 'way' : 'request'; } });
    (d.gone || []).forEach(id => { delete BY[id]; });
    CAT = CAT.filter(p => BY[p.id]);
    throw Object.assign(new Error('short'), { short: (d.short || []).map(s => (BY[s.id] || {}).name).filter(Boolean) });
  }
  if (d.closed) SET.open = false;
  if (!r.ok) throw Object.assign(new Error(d.error || 'server'), { code: d.code || (r.status >= 500 ? 'unavailable' : '') });
  return d.orders || [];
}
async function place() {
  const L = lines();
  if (!String(ME.name || '').trim() || !String(ME.address || '').trim()) { P.err = t('need'); return drawPanel(); }
  const phone = USER.phoneNumber || e164(ME.phone);
  if (!/^[+][0-9]{10,15}$/.test(phone)) { P.err = t('needPhone'); return drawPanel(); }
  P.busy = 'place'; P.err = ''; drawPanel();
  try {
    if (SET.orderApi) {
      P.placed = await placeViaServer(L, phone);
      Object.keys(CART).forEach(k => delete CART[k]); save('shop-cart', CART); delete ME.note; save('shop-me', ME);
      P.mode = 'done'; P.busy = ''; return draw();
    }
    const { S, fs } = FBX, now = new Date().toISOString(), b = S.writeBatch(fs), out = [];
    const base = { uid: USER.uid, phone, verified: !!USER.phoneNumber, email: USER.email || '', name: ME.name.trim(), address: ME.address.trim(), note: String(ME.note || '').trim(), lang: LANG, createdAt: now };
    const group = newCode();
    if (L.o.length) out.push(Object.assign({}, base, { kind: 'order', status: 'new', method: L.method, lines: pack(L.o), goods: L.og, delivery: L.od, creditUsed: L.oc, total: L.ot, downPct: L.opct, down: L.odown, group, code: group }));
    if (L.r.length) out.push(Object.assign({}, base, { kind: 'request', status: 'requested', method: L.method, lines: pack(L.r), goods: L.rg, delivery: L.rd, creditUsed: L.rc, total: L.rt, downPct: L.rpct, down: L.rdown, group, code: L.o.length ? newCode() : group }));
    const cref = S.doc(fs, 'customers', USER.uid);
    if (!CUST) b.set(cref, { name: base.name, phone, verified: base.verified, email: base.email, address: base.address, createdAt: now, updatedAt: now });
    else if (CUST.name !== base.name || CUST.address !== base.address || (!base.verified && CUST.phone !== phone)) b.update(cref, Object.assign({ name: base.name, address: base.address, updatedAt: now }, base.verified ? {} : { phone }));
    P.placed = out.map(o => { const r = S.doc(S.collection(fs, 'orders')); b.set(r, o); return Object.assign({ id: r.id }, o); });
    await b.commit();
    Object.keys(CART).forEach(k => delete CART[k]); save('shop-cart', CART); delete ME.note; save('shop-me', ME);
    P.mode = 'done';
  } catch (e) { console.warn(e); P.err = e.short ? t('shortNow', e.short.join(', ')) : errMsg(e); P.placed = []; }
  P.busy = ''; draw();
}

/* ---- InstaPay screenshot: made small enough to keep with the order ---- */
async function shrink(file) {
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
  for (const [max, q] of [[1200, .62], [900, .5], [700, .42]]) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const u = c.toDataURL('image/jpeg', q); if (u.length < 650000) { URL.revokeObjectURL(img.src); return u; }
  }
  throw new Error('too big');
}
let proofFor = '';
$('#proofin').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0], id = proofFor; e.target.value = ''; if (!f || !id) return;
  P.busy = 'proof:' + id; P.err = ''; drawPanel();
  try { const u = await shrink(f), { S, fs } = FBX, now = new Date().toISOString(), b = S.writeBatch(fs);
    /* the picture goes in its own record; the order only notes that one was sent */
    b.set(S.doc(fs, 'proofs', id), { uid: USER.uid, data: u, at: now });
    b.update(S.doc(fs, 'orders', id), { proof: true, proofAt: now, updatedAt: now });
    await b.commit(); toast(t('proofOk')); }
  catch (x) { console.warn(x); P.err = x && x.message === 'too big' ? t('tooBig') : errMsg(x); }
  P.busy = ''; drawPanel();
});
async function updMine(id, data) {
  try { const { S, fs } = FBX; await S.updateDoc(S.doc(fs, 'orders', id), Object.assign({ updatedAt: new Date().toISOString() }, data)); P.err = ''; }
  catch (e) { console.warn(e); P.err = errMsg(e); }
  P.cancelling = ''; draw();
}

/* ---- events ---- */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-add]');
  if (a) { const p = BY[a.dataset.add]; if (!p) return; setQty(p.id, 1); toast(p.status === 'in' ? t('added') : t('requested')); return draw(); }
  const s = e.target.closest('[data-q]');
  if (s) { const [id, d] = s.dataset.q.split(':'); setQty(id, (CART[id] | 0) + +d); return draw(); }
  const c = e.target.closest('[data-avail]'); if (c) { UI.avail = c.dataset.avail; return draw(); }
  const cp = e.target.closest('[data-copy]'); if (cp) { navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy).then(() => toast(t('copied'))).catch(() => { }); return; }
  const pf = e.target.closest('[data-proof]'); if (pf) { proofFor = pf.dataset.proof; return $('#proofin').click(); }
  if (e.target.closest('#langbtn')) { LANG = LANG === 'ar' ? 'en' : 'ar'; localStorage.setItem('shop-lang', LANG); return draw(); }
  if (e.target.closest('#cartbtn')) { P.mode = 'cart'; P.err = ''; return draw(); }
  if (e.target.closest('#mebtn')) { P.mode = 'mine'; P.err = ''; return draw(); }
  if (e.target === $('#panel')) { P.mode = ''; return draw(); }
  const mm = e.target.closest('[data-mine]');
  if (mm) {
    const [act, id] = mm.dataset.mine.split(':'), o = MINE.find(x => x.id === id) || P.placed.find(x => x.id === id), now = new Date().toISOString();
    const refTo = () => { const v = (document.getElementById('refto-' + id) || $('#credto') || {}).value || ''; if (v.trim()) { ME.instapay = v.trim(); save('shop-me', ME); } return v.trim(); };
    if (act === 'credask') { P.creditAsk = true; return drawPanel(); }
    if (act === 'credref') { const v = refTo(); if (!v) return; const { S, fs } = FBX;
      S.updateDoc(S.doc(fs, 'customers', USER.uid), { creditRefundTo: v, creditRefundAt: now }).then(() => { P.creditAsk = false; drawPanel(); }).catch(x => { P.err = errMsg(x); drawPanel(); }); return; }
    if (!o) return;
    if (act === 'take') return updMine(id, { status: 'new' });
    if (act === 'cancel') { const paidBack = (o.downPaid || o.proof) && num(o.down) > 0; if (!confirm(paidBack ? t('cancelAskPaid', money(num(o.down))) : t('cancelAsk'))) return; if ((o.downPaid || o.proof) && num(o.down) > 0) { P.cancelling = id; return drawPanel(); } return updMine(id, { status: 'cancelled', cancelledAt: now }); }
    if (act === 'nocx') { P.cancelling = ''; return drawPanel(); }
    if (act === 'cxrefund' || act === 'refund') { const v = refTo(); if (!v) { const i = document.getElementById('refto-' + id); if (i) i.focus(); return; }
      return updMine(id, Object.assign({ refund: 'refund', refundTo: v }, act === 'cxrefund' ? { status: 'cancelled', cancelledAt: now } : {})); }
    if (act === 'cxcredit' || act === 'credit') return updMine(id, Object.assign({ refund: 'credit' }, act === 'cxcredit' ? { status: 'cancelled', cancelledAt: now } : {}));
  }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'retry') load();
  if (act === 'clear') { Object.assign(UI, { q: '', avail: '', cat: '', brand: '' }); draw(); }
  if (act === 'cart') { P.mode = 'cart'; P.err = ''; draw(); }
  if (act === 'close') { P.mode = ''; P.err = ''; P.cancelling = ''; draw(); }
  if (act === 'dropgone') { lines().gone.forEach(id => delete CART[id]); save('shop-cart', CART); draw(); }
  if (act === 'send') sendCode();
  if (act === 'code') checkCode();
  if (act === 'google') googlePopup();
  if (act === 'renum') { P.conf = null; P.err = ''; drawPanel(); }
  if (act === 'signout') { FBX && FBX.U.signOut(FBX.auth); P.conf = null; }
  if (act === 'place') place();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && P.mode) { P.mode = ''; draw(); }
  if (e.key === 'Enter' && e.target.id === 'phonein') sendCode();
  if (e.key === 'Enter' && e.target.id === 'codein') checkCode();
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { UI.q = e.target.value; drawGrid(); return; }
  if (e.target.id === 'codein' && e.target.value.replace(/\D/g, '').length === 6 && !P.busy) return checkCode();
  const k = e.target.dataset.me; if (k) { ME[k] = e.target.value; save('shop-me', ME); }
});
document.addEventListener('change', e => {
  const k = e.target.dataset.f; if (k) { UI[k] = e.target.value; return draw(); }
  const m = e.target.dataset.method; if (m) { ME.method = m; save('shop-me', ME); drawPanel(); }
});
/* coming back to the tab: fresh stock and prices */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && STATE === 'ok' && Date.now() - (load.at || 0) > 120000) { load.at = Date.now(); load(); } });
load.at = Date.now(); load();
