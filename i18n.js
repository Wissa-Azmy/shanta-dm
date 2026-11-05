/* ---------- language: English / العربية ----------
   The app is written in English. In Arabic mode every text the app shows is looked up here
   as it appears on screen (exact strings first, then patterns for strings with numbers or names),
   so the rest of the code stays unchanged. Saved data is never translated, only what is shown. */
const LANG = localStorage.getItem('shanta-lang') || (/^ar/i.test(navigator.language || '') ? 'ar' : 'en');
const AR = {}, AR_RX = [];
const rx = (re, fn) => AR_RX.push([re, fn]);

/* ---- navigation, shell, file box ---- */
Object.assign(AR, {
  'Overview': 'نظرة عامة', 'Who owes whom, at a glance': 'من يدين لمن، بنظرة سريعة',
  'Shipments': 'الشحنات', 'Boxes from Germany to Egypt': 'الصناديق من ألمانيا إلى مصر',
  'Purchases': 'المشتريات', 'What was bought at dm': 'ما تم شراؤه من dm',
  'Stock': 'المخزون', 'What is left and what to charge': 'المتبقي وسعر البيع المقترح',
  'Sales': 'المبيعات', 'What was sold in Egypt': 'ما تم بيعه في مصر',
  'Customers': 'العملاء', 'Who still owes what, and their payments': 'المتبقي على العملاء ومدفوعاتهم',
  'Expenses': 'المصروفات', 'Shipping, customs and other costs': 'الشحن والجمارك والتكاليف الأخرى',
  'Transfers': 'التحويلات', 'Money between the two of you': 'الأموال بينكما',
  'Ledger': 'السجل', 'Every movement: who, when, where, how much': 'كل حركة: من، متى، أين، وكم',
  'Settings': 'الإعدادات', 'Names, split, rate and your data file': 'الأسماء والتقسيم وسعر الصرف وملف البيانات',
  'Germany ⇄ Egypt': 'ألمانيا ⇄ مصر',
  'New shipment': 'شحنة جديدة', 'Add purchase': 'إضافة مشتريات', 'Record sale': 'تسجيل بيع', 'Credit payment': 'دفعة سداد',
  'Add expense': 'إضافة مصروف', 'Record transfer': 'تسجيل تحويل', 'Import dm receipt': 'استيراد فاتورة dm',
  'Purchase': 'شراء', 'Expense': 'مصروف', 'Sale': 'بيع', 'Transfer': 'تحويل',
  'Only in this browser': 'في هذا المتصفح فقط',
  'Not saved to a file yet. Click “Save as…” to pick a file on your disk.': 'لم يُحفظ في ملف بعد. اضغط «حفظ باسم…» لاختيار ملف على جهازك.',
  'Save as…': 'حفظ باسم…', 'Open': 'فتح', 'File needs permission': 'الملف يحتاج إلى إذن', 'Reconnect': 'إعادة الربط', 'Open other': 'فتح ملف آخر',
  'Unsaved changes': 'تغييرات غير محفوظة', 'Saved to disk': 'محفوظ على الجهاز', 'Save': 'حفظ',
  'Download a backup': 'نزّل نسخة احتياطية', 'Backup downloaded': 'تم تنزيل النسخة الاحتياطية',
  'This browser can’t write files directly. Download a backup after changes.': 'هذا المتصفح لا يستطيع الكتابة في الملفات مباشرة. نزّل نسخة احتياطية بعد كل تغيير.',
  'Download': 'تنزيل', 'Restore from file': 'استعادة من ملف', 'Fetching…': 'جارٍ الجلب…',
  'Edit': 'تعديل', 'Delete': 'حذف', 'Close': 'إغلاق', 'Remove': 'إزالة', 'Cancel': 'إلغاء', 'Everyone': 'الجميع', '→': '←',
  'Couldn’t get the live rate. Check your internet connection; you can still type the rate yourself.': 'تعذّر جلب السعر المباشر. تحقق من اتصالك بالإنترنت؛ ويمكنك كتابة السعر بنفسك.',
  'Used as the default for new entries and to show € amounts in EGP. Old entries keep their own rate.': 'يُستخدم افتراضياً للقيود الجديدة ولعرض مبالغ اليورو بالجنيه. القيود القديمة تحتفظ بسعرها.'
});

/* ---- overview ---- */
Object.assign(AR, {
  'Right now you are': 'أنتما الآن', 'All square': 'متعادلان', 'should send': '← تحويل إلى',
  'Record this payment': 'سجّل هذا التحويل', 'Profit split': 'تقسيم الربح',
  'Spent in total': 'إجمالي ما تم دفعه', '… still tied up in unsold stock': '… منها في مخزون لم يُبع',
  'Costs earned back so far': 'التكاليف المستردة حتى الآن', 'Profit share': 'نصيب الربح', 'Should have received': 'الرصيد المستحق',
  'Collected from customers': 'المحصّل من العملاء', 'Transfers received': 'تحويلات واردة', 'Transfers sent': 'تحويلات صادرة', 'Actually holds': 'الرصيد الفعلي',
  'Welcome. Let’s set up your ledger.': 'أهلاً بك. لنجهّز سجلك.',
  'Choose where the data lives:': 'اختر مكان حفظ البيانات:', 'click': 'اضغط', 'on the left to create a': 'في القائمة الجانبية لإنشاء ملف',
  'file on your disk. After that every change is written to it automatically. Share that file (e.g. via Google Drive or WhatsApp) so you both see the same numbers.': 'على جهازك. بعدها يُحفظ كل تغيير فيه تلقائياً. شارك هذا الملف (مثلاً عبر Google Drive أو واتساب) لتريا نفس الأرقام.',
  'Put your names, the profit split and today’s EGP rate in': 'ضع أسماءكما وتقسيم الربح وسعر الجنيه اليوم في',
  'Create a': 'أنشئ', 'Shipment': 'الشحنة', ', add your dm': '، ثم أضف إليها', 'to it, then record': 'من dm، ثم سجّل', 'and': 'و', 'as they happen.': 'أولاً بأول.',
  'Create first shipment': 'أنشئ أول شحنة', 'Load sample data to explore': 'حمّل بيانات تجريبية للاستكشاف',
  'Collected from sales': 'المحصّل من المبيعات', 'Profit so far': 'الربح حتى الآن', 'on goods sold': 'على البضاعة المباعة',
  'Stock not yet sold': 'مخزون لم يُبع بعد', 'Customers still owe': 'المتبقي على العملاء',
  'Money in vs money out, by month': 'الداخل مقابل الخارج شهرياً', 'Best earners': 'الأكثر ربحاً', 'No sales yet.': 'لا توجد مبيعات بعد.',
  'On the way': 'في الطريق', 'Nothing in transit.': 'لا شيء في الطريق.', 'Running low': 'على وشك النفاد', 'Stock levels look fine.': 'مستويات المخزون جيدة.',
  'Waiting for payment': 'بانتظار الدفع', 'Customer': 'العميل', 'Record payment': 'تسجيل دفعة', 'Everyone has paid.': 'الجميع دفع.',
  'Collected': 'المحصّل', 'Spent': 'المصروف'
});
rx(/^(\d+) units? at cost$/, (m, n) => `${n} وحدة بسعر التكلفة`);
rx(/^(\d+) sales? not fully paid$/, (m, n) => `${n} عملية بيع لم تُسدَّد بالكامل`);
rx(/^(\d+) sold$/, (m, n) => `بيع ${n}`);
rx(/^(.+) profit$/, (m, a) => `ربح ${a}`);
rx(/^(\d+(?:\.\d+)?) left$/, (m, n) => `متبقٍ ${n}`);
rx(/^due (.+)$/, (m, d) => `مستحق ${d}`);
rx(/^Counts only money customers have actually paid\. .* split (\d+)% (.+) \/ (\d+)% (.+)\. Money for unsold stock comes back as it sells\.$/,
  (m, a, n1, b, n2) => `يُحتسب فقط ما دفعه العملاء فعلاً. يسترد كل منكما أولاً ما دفعه في البضاعة التي خرجت من المخزون (تكلفة المنتج مع شحن وجمارك صندوقه)، ثم يُقسَّم الربح ${a}% ${n1} / ${b}% ${n2}. أموال المخزون غير المباع تعود مع بيعه.`);
rx(/^All amounts in € using each entry’s own exchange rate\. EGP shown at today’s rate of (.+)\.$/, (m, r) => `كل المبالغ باليورو بسعر صرف كل قيد. الجنيه معروض بسعر اليوم ${r}.`);
/* ---- shipments ---- */
Object.assign(AR, {
  'No shipments yet': 'لا توجد شحنات بعد',
  'A shipment is one box or suitcase going to Egypt. Create one, then add your dm purchases to it.': 'الشحنة هي صندوق أو حقيبة واحدة متجهة إلى مصر. أنشئ واحدة ثم أضف إليها مشترياتك من dm.',
  'Search shipments': 'ابحث في الشحنات', 'carrier?': 'شركة الشحن؟',
  'Packing': 'قيد التعبئة', 'Shipped': 'تم الشحن', 'In customs': 'في الجمارك', 'Delivered': 'تم التسليم',
  'Products': 'المنتجات', 'Shipping & other costs': 'الشحن وتكاليف أخرى', 'Shipping weight': 'وزن الشحن', 'Shipping per kg': 'الشحن لكل كجم',
  'weighed': 'موزون', 'calculated': 'محسوب', 'label': 'من الملصق', 'from box': 'من الصندوق', 'est.': 'تقديري',
  'Packed box on the scale': 'الصندوق المعبأ على الميزان', 'Sum of the products below': 'مجموع المنتجات أدناه',
  'What is left of the weighed box after the products with a label weight': 'ما تبقى من وزن الصندوق بعد المنتجات ذات الوزن المعروف',
  'No weight known: estimated from the price': 'الوزن غير معروف: مُقدَّر من السعر',
  'Shipping split': 'تقسيم الشحن', 'by price': 'حسب السعر', 'no weights': 'بلا أوزان',
  'No product weights and the box was not weighed': 'لا توجد أوزان للمنتجات ولم يُوزن الصندوق',
  'Sold / given away': 'مُباع / مُهدى', 'This box suggests about': 'يشير هذا الصندوق إلى تغليف بنحو', 'No products yet': 'لا توجد منتجات بعد',
  'Product': 'المنتج', 'dm receipt': 'فاتورة dm', 'Cost': 'تكلفة'
});
rx(/^Box #(\d+)$/, (m, n) => `صندوق #${n}`);
rx(/^(\d+) units?$/, (m, n) => `${n} وحدة`);
rx(/^(\d+) products?$/, (m, n) => `${n} منتج`);
rx(/^(\d+)% of goods$/, (m, n) => `${n}% من قيمة البضاعة`);
rx(/^(\d+)% of value$/, (m, n) => `${n}% من القيمة`);
rx(/^Content weight from the receipt or label \+ (.+)% packaging$/, (m, p) => `وزن المحتوى من الفاتورة أو الملصق + ${p}% تغليف`);
rx(/^The weighed box \((.+)\) is lighter than its products’ calculated weight \((.+)\)\. Check the box weight, the product weights or the packaging %\.$/,
  (m, a, b) => `الصندوق الموزون (${a}) أخف من الوزن المحسوب لمنتجاته (${b}). راجع وزن الصندوق أو أوزان المنتجات أو نسبة التغليف.`);
rx(/^packaging \(now (.+)%\)\.$/, (m, p) => `(الحالية ${p}%).`);
rx(/^Use (\d+(?:\.\d+)?)%$/, (m, p) => `استخدم ${p}%`);
rx(/^(.+) \(paid on delivery\)$/, (m, c) => `${tr(c)} (دُفع عند الاستلام)`);
rx(/^Mark (.+)$/, (m, s) => `نقل إلى «${tr(s)}»`);
rx(/^(.+): (Packing|Shipped|In customs|Delivered)$/, (m, n, s) => `${tr(n)}: ${tr(s)}`);
rx(/^Packaging set to (.+)%$/, (m, p) => `التغليف الآن ${p}%`);
rx(/^(\d+) weights filled in$/, (m, n) => `تمت إضافة ${n} وزن`);

/* ---- options used in forms and lists ---- */
Object.assign(AR, {
  'Skin care': 'العناية بالبشرة', 'Make-up': 'المكياج', 'Hair care': 'العناية بالشعر', 'Body care': 'العناية بالجسم', 'Fragrance': 'العطور',
  'Health & vitamins': 'الصحة والفيتامينات', 'Baby': 'الأطفال', 'Other': 'أخرى',
  'Card': 'بطاقة', 'Cash': 'نقداً', 'Bank transfer': 'تحويل بنكي', 'Vodafone Cash': 'فودافون كاش', 'Western Union': 'ويسترن يونيون', 'Cash hand-over': 'تسليم نقدي',
  'Shipping': 'الشحن', 'Customs & duties': 'الجمارك والرسوم', 'Packaging': 'التغليف', 'Transfer fees': 'رسوم التحويل', 'Delivery to customer': 'التوصيل للعميل', 'Marketing': 'التسويق',
  'Sale to customer': 'بيع لعميل', 'Gift / sample': 'هدية / عينة', 'Damaged / lost': 'تالف / مفقود',
  'EGP (Egyptian pound)': 'جنيه مصري (EGP)', 'EUR (euro)': 'يورو (EUR)', 'Not shipped yet': 'لم يُشحن بعد', 'not shipped': 'لم يُشحن',
  'Egypt Post': 'البريد المصري', 'Traveller / suitcase': 'مسافر / حقيبة', 'Choose…': 'اختر…', 'Other…': 'أخرى…', 'Delivery': 'توصيل'
});

/* ---- form engine and schemas ---- */
Object.assign(AR, {
  'New shipment': 'شحنة جديدة', 'Edit shipment': 'تعديل الشحنة', 'New purchase': 'مشتريات جديدة', 'Edit purchase': 'تعديل المشتريات',
  'New sale': 'بيع جديد', 'Edit sale': 'تعديل البيع', 'New expense': 'مصروف جديد', 'Edit expense': 'تعديل المصروف',
  'New money transfer': 'تحويل مالي جديد', 'Edit money transfer': 'تعديل التحويل المالي', 'New credit payment': 'دفعة سداد جديدة', 'Edit credit payment': 'تعديل دفعة السداد',
  'Shipment saved': 'تم حفظ الشحنة', 'Purchase saved': 'تم حفظ المشتريات', 'Sale saved': 'تم حفظ البيع', 'Expense saved': 'تم حفظ المصروف',
  'Money transfer saved': 'تم حفظ التحويل', 'Credit payment saved': 'تم حفظ دفعة السداد', 'Deleted': 'تم الحذف',
  'Delete this purchase?': 'حذف هذه المشتريات؟', 'Delete this expense?': 'حذف هذا المصروف؟', 'Delete this money transfer?': 'حذف هذا التحويل؟', 'Delete this credit payment?': 'حذف دفعة السداد هذه؟',
  'Save & add another': 'حفظ وإضافة آخر',
  'A box/parcel going from Germany to Egypt. Add the products to it from Purchases.': 'صندوق أو طرد متجه من ألمانيا إلى مصر. أضف إليه المنتجات من شاشة المشتريات.',
  'Name': 'الاسم', 'Ship date': 'تاريخ الشحن', 'Status': 'الحالة', 'Carrier': 'شركة الشحن', 'Other carrier': 'شركة شحن أخرى', 'Tracking number': 'رقم التتبع',
  'Weighed box (kg)': 'وزن الصندوق (كجم)',
  'Optional: the packed box on the scale. Products without a known weight share what is left after the known ones; also used to check the packaging %.': 'اختياري: وزن الصندوق المعبأ على الميزان. المنتجات بلا وزن معروف تتقاسم ما يتبقى بعد المعروفة، ويُستخدم أيضاً للتحقق من نسبة التغليف.',
  'Delivered on': 'تاريخ التسليم', 'Notes': 'ملاحظات', 'Shipping cost (optional, saved as an expense on this shipment)': 'تكلفة الشحن (اختياري، تُحفظ كمصروف على هذه الشحنة)',
  'Amount': 'المبلغ', 'Currency': 'العملة', 'Rate (EGP per €1)': 'سعر الصرف (جنيه لكل €1)', 'Rate on that day; used to convert to €': 'سعر ذلك اليوم؛ يُستخدم للتحويل إلى اليورو',
  'Paid by': 'الدافع', 'Paid on delivery in Egypt': 'دُفع عند الاستلام في مصر', 'Type the name of the other carrier.': 'اكتب اسم شركة الشحن الأخرى.',
  'Delete this shipment? Its products and costs stay, they just become unassigned.': 'حذف هذه الشحنة؟ تبقى منتجاتها وتكاليفها لكن دون ربطها بصندوق.',
  'One product line from a dm receipt. Use “Save & add another” to enter a whole receipt.': 'سطر منتج واحد من فاتورة dm. استخدم «حفظ وإضافة آخر» لإدخال فاتورة كاملة.',
  'Date bought': 'تاريخ الشراء', 'Where': 'المكان', 'Brand': 'الماركة', 'Category': 'الفئة', 'Quantity': 'الكمية', 'Price per unit (€)': 'سعر الوحدة (€)',
  'Content per unit (g or ml)': 'المحتوى للوحدة (جم أو مل)',
  'Net weight from the label (1 ml counts as 1 g). Used to split shipping; packaging is added automatically. Leave empty to read it from the product name.': 'الوزن الصافي من الملصق (1 مل = 1 جم). يُستخدم لتقسيم الشحن ويُضاف التغليف تلقائياً. اتركه فارغاً لقراءته من اسم المنتج.',
  'Paid with': 'وسيلة الدفع', 'Receipt / order no.': 'رقم الفاتورة / الطلب', 'Quantity must be at least 1.': 'يجب أن تكون الكمية 1 على الأقل.',
  'This product has sales recorded. Delete those sales first.': 'لهذا المنتج مبيعات مسجلة. احذف تلك المبيعات أولاً.',
  'Something leaving stock in Egypt: a sale, a gift/sample, or a damaged item.': 'كل ما يخرج من المخزون في مصر: بيع أو هدية/عينة أو قطعة تالفة.',
  'Date': 'التاريخ', 'Type': 'النوع', 'Choose a product…': 'اختر منتجاً…', 'Price per unit': 'سعر الوحدة', 'Money collected by': 'المحصِّل',
  'Customer has paid': 'دفع العميل', 'Pick a product.': 'اختر منتجاً.', 'Enter the price.': 'أدخل السعر.',
  'Any cost other than the products: shipping, customs, packaging, transfer fees… Link it to a shipment to spread it over that box’s products.': 'أي تكلفة غير المنتجات: شحن، جمارك، تغليف، رسوم تحويل… اربطها بشحنة لتوزيعها على منتجات ذلك الصندوق.',
  'Description': 'الوصف', 'Not linked (general expense)': 'غير مرتبط (مصروف عام)', 'Amount must be above zero.': 'يجب أن يكون المبلغ أكبر من صفر.',
  'Money moving between the two of you, e.g. your friend sending sales money to Germany.': 'أموال تنتقل بينكما، مثل إرسال أموال المبيعات إلى ألمانيا.',
  'Method': 'الطريقة', 'From': 'من', 'To': 'إلى', 'From and To must be different people.': 'يجب أن يكون «من» و«إلى» شخصين مختلفين.'
});
rx(/^“(.+)” is required\.$/, (m, f) => `«${tr(f)}» مطلوب.`);
rx(/^(\d+) of these are already sold or given away, so quantity can’t be lower than that\.$/, (m, n) => `تم بيع أو إهداء ${n} منها بالفعل، لذا لا يمكن أن تكون الكمية أقل من ذلك.`);
rx(/^Only (\d+) of this product are left in stock\.$/, (m, n) => `لم يتبقَّ من هذا المنتج سوى ${n} في المخزون.`);
/* ---- purchases, stock, expenses, transfers, ledger ---- */
Object.assign(AR, {
  'Search product, brand, receipt…': 'ابحث عن منتج، ماركة، فاتورة…', 'Qty': 'الكمية', 'Per unit': 'للوحدة', 'Total': 'الإجمالي',
  'Where / how': 'أين / كيف', 'Not shipped': 'لم يُشحن', 'No purchases yet.': 'لا توجد مشتريات بعد.',
  'In Germany': 'في ألمانيا', 'In Egypt': 'في مصر', 'All boxes': 'كل الصناديق', 'Not in a box': 'خارج الصناديق', 'Box': 'الصندوق',
  'Reset filters': 'إعادة ضبط الفلاتر', 'Search stock': 'ابحث في المخزون', 'Location': 'الموقع', 'Bought': 'المشترى', 'Sold': 'المباع',
  'Gift/lost': 'هدية/مفقود', 'Left': 'المتبقي', 'Cost incl. shipping': 'التكلفة شاملة الشحن', 'Avg sold at': 'متوسط سعر البيع', 'Markup': 'هامش الربح',
  'no shipment': 'بلا شحنة', 'Estimated from price': 'مُقدَّر من السعر',
  'Share of the weighed box after the products with a known weight': 'حصة من وزن الصندوق بعد المنتجات ذات الوزن المعروف',
  'Sell': 'بيع', 'Nothing here.': 'لا شيء هنا.', 'Stock value at cost': 'قيمة المخزون بالتكلفة',
  'Search expenses': 'ابحث في المصروفات', 'What': 'البند', 'In €': 'باليورو', 'on delivery': 'عند الاستلام', 'general': 'عام', 'No expenses yet.': 'لا توجد مصروفات بعد.',
  'Search transfers': 'ابحث في التحويلات', 'From → To': 'من ← إلى', 'No transfers yet.': 'لا توجد تحويلات بعد.',
  'Sale · down payment': 'بيع · دفعة مقدمة', 'Sale · on credit': 'بيع · آجل', 'Money in': 'وارد', 'Money out': 'صادر', 'Owed by customer': 'على العميل',
  'Between you': 'بينكما', 'All movements': 'كل الحركات', 'Export CSV': 'تصدير CSV', 'Search everything': 'ابحث في كل شيء',
  'When': 'متى', 'Who': 'من', 'How': 'كيف', 'How much': 'كم', 'Flow': 'الاتجاه', 'Nothing recorded yet.': 'لم يُسجَّل شيء بعد.'
});
rx(/^(\d+) lines?$/, (m, n) => `${n} سطر`);
rx(/^(\d+) entries$/, (m, n) => `${n} قيد`);
rx(/^Still in stock \((\d+)\)$/, (m, n) => `متوفر (${n})`);
rx(/^Sold out \((\d+)\)$/, (m, n) => `نفد (${n})`);
rx(/^All bought \((\d+)\)$/, (m, n) => `كل المشتريات (${n})`);
rx(/^Price for (.+)% markup$/, (m, p) => `السعر لهامش ${p}%`);
rx(/^(.+) not paid yet$/, (m, n) => `${n} لم يُدفع بعد`);
rx(/^(.+) \+ packaging$/, (m, g) => `${tr(g)} + تغليف`);
rx(/^(.+) \+ (.+) shipping$/, (m, a, b) => `${a} + ${b} شحن`);
rx(/^EGP amounts use today’s rate \((.+) EGP\/€\)\.$/, (m, r) => `مبالغ الجنيه بسعر اليوم (${r} جنيه/€).`);
rx(/^Sale to (.+)$/, (m, c) => `بيع لـ ${c}`);
rx(/^(\d+) products? to (.+)$/, (m, n, c) => `${n} منتج إلى ${c}`);
rx(/^(.+), on delivery$/, (m, h) => `${tr(h)}، عند الاستلام`);

/* ---- settings and the shipping info box ---- */
Object.assign(AR, {
  'The two of you': 'أنتما الاثنان', 'Your name (in Germany)': 'اسمك (في ألمانيا)', 'Friend’s name (in Egypt)': 'اسم صديقك (في مصر)',
  'Your share of the profit (%)': 'نصيبك من الربح (%)', 'Default place to buy': 'مكان الشراء الافتراضي', 'Default city for sales': 'مدينة البيع الافتراضية',
  'Money & stock': 'المال والمخزون', 'Today’s rate: EGP for €1': 'سعر اليوم: جنيه لكل €1', 'Live rate': 'السعر المباشر',
  'Update the rate from the internet once a day': 'حدّث السعر من الإنترنت مرة يومياً', 'Target markup on cost (%)': 'هامش الربح المستهدف على التكلفة (%)',
  'Used for the suggested selling price.': 'يُستخدم لسعر البيع المقترح.', 'Packaging added to content weight (%)': 'التغليف المضاف إلى وزن المحتوى (%)',
  'Receipts only show the net content. This much is added for bottle, jar and box when splitting shipping by weight.': 'الفواتير تُظهر المحتوى الصافي فقط. تُضاف هذه النسبة للزجاجة والعلبة والكرتونة عند تقسيم الشحن حسب الوزن.',
  'Warn when stock is at or below': 'نبّه عندما يصل المخزون إلى أو أقل من', 'Backup & sync': 'النسخ الاحتياطي والمزامنة',
  'Data is written straight to a': 'تُكتب البيانات مباشرة في ملف',
  'file on your disk. Pick it once with “Save as…”; after that every change is saved to it automatically. A backup copy also stays in this browser.': 'على جهازك. اختره مرة واحدة عبر «حفظ باسم…»، وبعدها يُحفظ كل تغيير فيه تلقائياً. وتبقى نسخة احتياطية أيضاً في هذا المتصفح.',
  'This browser can’t write to files directly, so use “Download backup” to save a': 'هذا المتصفح لا يكتب في الملفات مباشرة، لذا استخدم «تنزيل نسخة احتياطية» لحفظ ملف',
  'file and “Import” to load it again.': 'ثم «استعادة من ملف» لتحميله مجدداً.',
  'Save to the file automatically after every change': 'احفظ في الملف تلقائياً بعد كل تغيير', 'Open file': 'فتح ملف', 'Download backup': 'تنزيل نسخة احتياطية',
  'Start over': 'البدء من جديد', 'Load sample data': 'تحميل بيانات تجريبية', 'Clear all data': 'مسح كل البيانات',
  'Sample data shows how a full cycle looks. Before anything is cleared or replaced, a full backup is made: in the cloud when you are signed in (open it from the list above), otherwise as a downloaded file.': 'البيانات التجريبية توضح شكل دورة كاملة. قبل مسح أو استبدال أي شيء تُحفظ نسخة احتياطية كاملة: في السحابة إذا كنت مسجّل الدخول (افتحها من القائمة أعلاه)، وإلا كملف يتم تنزيله.',
  'How shipping costs are split over a box': 'كيف تُقسَّم تكاليف الشحن على الصندوق',
  'Each box’s costs (shipping, customs and anything else added with “+ Cost”) are shared by its products': 'تتقاسم منتجات كل صندوق تكاليفه (الشحن والجمارك وأي شيء أُضيف بزر «+ تكلفة»)',
  'by weight': 'حسب الوزن', 'Product’s share': 'حصة المنتج', '= box costs × its shipping weight ÷ total shipping weight of the box': '= تكاليف الصندوق × وزن شحنه ÷ إجمالي وزن شحن الصندوق',
  '= purchase price + its share': '= سعر الشراء + حصته', 'Example:': 'مثال:', 'Content weight': 'وزن المحتوى',
  'comes from the receipt (“150 ml”, “200g”, “1,5kg”; 1 ml counts as 1 g). You can change it on each purchase.': 'يأتي من الفاتورة («150 ml» أو «200g» أو «1,5kg»؛ 1 مل = 1 جم). يمكنك تغييره في كل عملية شراء.',
  'No weight known': 'الوزن غير معروف',
  '(e.g. tablets sold by count): it is estimated from the price, using the box’s average grams per euro. These show “est.”.': '(مثل الأقراص التي تُباع بالعدد): يُقدَّر من السعر بمتوسط الجرامات لكل يورو في الصندوق، ويظهر بجانبه «تقديري».',
  'Weighed box:': 'صندوق موزون:',
  'if you enter the packed box’s weight on the shipment, products without a weight share what is left after the known ones (shown as “from box”) instead of being estimated. If every product has a weight, the card suggests a better packaging %.': 'إذا أدخلت وزن الصندوق المعبأ في الشحنة، تتقاسم المنتجات بلا وزن ما يتبقى بعد المعروفة (يظهر «من الصندوق») بدلاً من التقدير. وإذا كان لكل المنتجات وزن، تقترح البطاقة نسبة تغليف أدق.',
  'A box with no weights at all': 'صندوق بلا أي أوزان', '(and not weighed) is split by purchase price instead.': '(ولم يُوزن) يُقسَّم حسب سعر الشراء بدلاً من ذلك.',
  'Whoever paid the box costs gets them back in the same proportion as its products are sold.': 'من دفع تكاليف الصندوق يستردها بنفس نسبة بيع منتجاته.'
});
rx(/^(.+) gets (\d+(?:\.\d+)?)%$/, (m, n, p) => `نصيب ${n}: ${p}%`);
rx(/^Typed in by hand on (.+)\. Used as the default for new entries; old entries keep their own rate\.$/, (m, d) => `أُدخل يدوياً في ${d}. يُستخدم افتراضياً للقيود الجديدة، والقيود القديمة تحتفظ بسعرها.`);
rx(/^Live rate from (.+?), (.+)\. You can still type your own\. Used as the default for new entries; old entries keep their own rate\.$/, (m, s, d) => `سعر مباشر من ${s}، ${d}. يمكنك كتابة سعرك. يُستخدم افتراضياً للقيود الجديدة، والقيود القديمة تحتفظ بسعرها.`);
rx(/^Live rate: €1 = (.+) EGP( \(unchanged\))?$/, (m, r, u) => `السعر المباشر: €1 = ${r} جنيه${u ? ' (بدون تغيير)' : ''}`);
rx(/^= content weight × \(1 \+ (.+)% packaging\)$/, (m, p) => `= وزن المحتوى × (1 + ${p}% تغليف)`);
rx(/^a (.+) cream ships as (.+) \((.+) \+ (.+)%\)\. In a box of (.+) with (.+) shipping it carries (.+) × (.+) ÷ (.+) =$/,
  (m, a, b, c, p, box, cost, c2, b2, box2) => `كريم ${tr(a)} يُشحن كـ ${tr(b)} (${tr(c)} + ${p}%). في صندوق ${tr(box)} بتكلفة شحن ${cost} يتحمل ${c2} × ${tr(b2)} ÷ ${tr(box2)} =`);
rx(/^\(bottle, jar, box\) isn’t on the receipt, so (.+)% is added\. Change it in Settings → Money & stock\.$/, (m, p) => `(الزجاجة والعلبة والكرتونة) غير موجود في الفاتورة، لذا تُضاف ${p}%. غيّره من الإعدادات ← المال والمخزون.`);
rx(/^Read weights from product names for (\d+) older purchases?$/, (m, n) => `اقرأ الأوزان من أسماء المنتجات لـ ${n} من المشتريات القديمة`);
/* ---- deleting a box ---- */
Object.assign(AR, {
  'This box has': 'يحتوي هذا الصندوق على', '. What should happen to them?': '. ماذا تريد أن تفعل بها؟', '.': '.',
  'Keep them, unassigned': 'الإبقاء عليها دون صندوق', 'Products show as “Not shipped”, costs become general expenses.': 'تظهر المنتجات كـ«لم يُشحن» وتصبح التكاليف مصروفات عامة.',
  'Move them to another box': 'نقلها إلى صندوق آخر', 'Products and costs go to the box you pick; its cost split is recalculated.': 'تنتقل المنتجات والتكاليف إلى الصندوق الذي تختاره ويُعاد حساب تقسيم تكاليفه.',
  'There is no other box yet. Create one first.': 'لا يوجد صندوق آخر بعد. أنشئ واحداً أولاً.', 'Delete them too': 'حذفها أيضاً',
  'Not possible: some of these products have sales. Delete those sales first, or move the products to another box.': 'غير ممكن: بعض هذه المنتجات لها مبيعات. احذف تلك المبيعات أولاً، أو انقل المنتجات إلى صندوق آخر.',
  'Removes the box, its products and its costs. A backup is made first (in the cloud, listed under Settings).': 'يحذف الصندوق ومنتجاته وتكاليفه. تُحفظ نسخة احتياطية أولاً (في السحابة، تجدها في الإعدادات).',
  'Removes the box, its products and its costs. A backup is made first (downloaded as a file).': 'يحذف الصندوق ومنتجاته وتكاليفه. تُحفظ نسخة احتياطية أولاً (كملف يتم تنزيله).',
  'Delete box': 'حذف الصندوق', 'Box deleted': 'تم حذف الصندوق', 'Pick a box to move to.': 'اختر الصندوق المراد النقل إليه.', 'Saving a backup…': 'جارٍ حفظ نسخة احتياطية…',
  'The backup failed, so nothing was deleted.': 'فشل النسخ الاحتياطي، لذا لم يُحذف شيء.',
  'Sales were added for these products meanwhile, so nothing was deleted.': 'أُضيفت مبيعات لهذه المنتجات في الأثناء، لذا لم يُحذف شيء.'
});
rx(/^(\d+) product lines?$/, (m, n) => `${n} سطر منتجات`);
rx(/^(\d+) costs?$/, (m, n) => `${n} تكلفة`);
rx(/^\((\d+) units?, ([^)]+)\)(.*)$/, (m, n, v, rest) => `(${n} وحدة، ${v})${rest ? tr(rest) : ''}`);
rx(/^\(([^)]+)\)(\..*)$/, (m, v, rest) => `(${v})${tr(rest)}`);
rx(/^\. (\d+) sale lines? (?:is|are) recorded for its products\. What should happen to them\?$/, (m, n) => `. يوجد ${n} سطر مبيعات مسجل لمنتجاته. ماذا تريد أن تفعل بها؟`);
rx(/^Delete (.+)\? It has no products or costs\.$/, (m, n) => `حذف ${tr(n)}؟ لا يحتوي على منتجات أو تكاليف.`);
rx(/^(.+) deleted; its contents moved to (.+)$/, (m, a, b) => `تم حذف ${tr(a)} ونُقل محتواه إلى ${tr(b)}`);
rx(/^(.+) deleted with (\d+) products\. A backup was saved first\.$/, (m, a, n) => `تم حذف ${tr(a)} مع ${n} منتج. حُفظت نسخة احتياطية أولاً.`);
rx(/^(.+) deleted; its contents are unassigned$/, (m, a) => `تم حذف ${tr(a)} وأصبح محتواه دون صندوق`);
rx(/^Automatic backup before deleting (.+) with its products$/, (m, a) => `نسخة تلقائية قبل حذف ${tr(a)} مع منتجاته`);
rx(/^Couldn’t reach the cloud to make a backup, so nothing was deleted\. ?(.*)$/, (m, x) => `تعذّر الوصول إلى السحابة لعمل نسخة احتياطية، لذا لم يُحذف شيء. ${tr(x)}`.trim());

/* ---- sale editor, sales list, credit payments, customers ---- */
Object.assign(AR, {
  'Add every product the customer takes, then any extra costs such as delivery or packaging.': 'أضف كل منتج يأخذه العميل، ثم أي تكاليف إضافية مثل التوصيل أو التغليف.',
  'Payment': 'الدفع', 'e.g. 500': 'مثلاً 500', 'Due date for the rest (optional)': 'موعد سداد الباقي (اختياري)',
  'Paid in full': 'مدفوع بالكامل', 'Down payment, rest on credit': 'دفعة مقدمة والباقي آجل', 'On credit (nothing paid now)': 'آجل (لم يُدفع شيء الآن)',
  'Line total': 'إجمالي السطر', 'Add product': 'إضافة منتج', 'Extra costs': 'تكاليف إضافية', 'e.g. Bosta courier': 'مثلاً مندوب بوسطة',
  'No extra costs. Add delivery, packaging or anything else this sale cost you, or that the customer pays on top.': 'لا توجد تكاليف إضافية. أضف التوصيل أو التغليف أو أي شيء كلّفك هذا البيع، أو يدفعه العميل فوق السعر.',
  'Delete sale': 'حذف البيع', 'Save sale': 'حفظ البيع', 'Extras the customer pays': 'إضافات يدفعها العميل', 'Customer pays in total': 'إجمالي ما يدفعه العميل',
  'Paid now': 'المدفوع الآن', 'the customer': 'العميل', 'Units leaving stock': 'وحدات تخرج من المخزون', 'Product cost incl. shipping': 'تكلفة المنتجات شاملة الشحن',
  'Extra costs we pay': 'تكاليف إضافية ندفعها', 'Profit on this sale': 'ربح هذا البيع', 'Cost of this gift': 'تكلفة هذه الهدية', 'Cost of this loss': 'تكلفة هذه الخسارة',
  'Add at least one product with a quantity.': 'أضف منتجاً واحداً على الأقل مع الكمية.', 'Enter a price for every product.': 'أدخل سعراً لكل منتج.',
  'Enter the customer’s name: the rest goes on their credit balance.': 'أدخل اسم العميل: الباقي يُسجَّل عليه آجلاً.',
  'Enter the down payment, or choose “On credit” if nothing was paid now.': 'أدخل الدفعة المقدمة، أو اختر «آجل» إذا لم يُدفع شيء الآن.',
  'The down payment covers the whole sale; choose “Paid in full” instead.': 'الدفعة المقدمة تغطي البيع كله؛ اختر «مدفوع بالكامل» بدلاً من ذلك.',
  'Sale deleted': 'تم حذف البيع', 'Delete this sale with all its products and extra costs? The products go back into stock.': 'حذف هذا البيع بكل منتجاته وتكاليفه الإضافية؟ تعود المنتجات إلى المخزون.',
  'Nothing left to pay on this sale': 'لا يوجد مبلغ متبقٍ على هذا البيع', 'Paid': 'مدفوع',
  '(deleted product)': '(منتج محذوف)', 'Search product, customer…': 'ابحث عن منتج، عميل…', 'All types': 'كل الأنواع', 'Not fully paid': 'غير مسدد بالكامل',
  'Overdue': 'متأخر', 'Gifts': 'هدايا', 'Customer pays': 'يدفع العميل', 'Profit': 'الربح', 'Collected by': 'المحصِّل',
  'No sales yet. Press “Record sale”, or “Sell” on the Stock screen.': 'لا توجد مبيعات بعد. اضغط «تسجيل بيع» أو «بيع» في شاشة المخزون.',
  'Profit = what the customer pays, minus the products’ cost including shipping from Germany, minus extra costs like delivery and packaging.': 'الربح = ما يدفعه العميل، ناقص تكلفة المنتجات شاملة الشحن من ألمانيا، ناقص التكاليف الإضافية مثل التوصيل والتغليف.',
  'Money a customer pays later against what they still owe.': 'مبلغ يدفعه العميل لاحقاً من المتبقي عليه.', 'Choose a customer…': 'اختر عميلاً…', 'Nobody owes anything': 'لا أحد عليه شيء',
  'Pays for': 'مقابل', 'Oldest open sales first': 'المبيعات المفتوحة الأقدم أولاً', 'in total': 'إجمالاً', 'in total.': 'إجمالاً.', 'in total, of which': 'إجمالاً، منها',
  'is overdue': 'متأخرة', 'is overdue.': 'متأخرة.', 'Enter the amount paid.': 'أدخل المبلغ المدفوع.', 'This customer has nothing left to pay.': 'لا يوجد مبلغ متبقٍ على هذا العميل.',
  'Customers owe': 'المتبقي على العملاء', 'past the due date': 'تجاوز موعد الاستحقاق', 'Credit payments': 'دفعات السداد', 'Search customer': 'ابحث عن عميل',
  'Still owes': 'المتبقي', 'Due': 'الاستحقاق', 'Open sales': 'مبيعات مفتوحة', 'Nothing': 'لا شيء', 'Open sale': 'فتح البيع', 'none': 'لا يوجد',
  'No customers yet. They appear here when you record a sale with a customer name.': 'لا يوجد عملاء بعد. يظهرون هنا عند تسجيل بيع باسم عميل.',
  'No credit payments yet.': 'لا توجد دفعات سداد بعد.'
});
rx(/^Down payment now \((\w+)\)$/, (m, c) => `الدفعة المقدمة الآن (${c})`);
rx(/^Price per unit \((\w+)\)$/, (m, c) => `سعر الوحدة (${c})`);
rx(/^We pay \((\w+)\)$/, (m, c) => `ندفع (${c})`);
rx(/^Customer pays \((\w+)\)$/, (m, c) => `يدفع العميل (${c})`);
rx(/^(\d+) available$/, (m, n) => `${n} متاح`);
rx(/^Cost incl\. shipping (.+)$/, (m, a) => `التكلفة شاملة الشحن ${a}`);
rx(/^(\d+(?:\.\d+)?)% markup → (.+)$/, (m, p, a) => `هامش ${p}% ← ${a}`);
rx(/^Products \((\d+) units?\)$/, (m, n) => `المنتجات (${n} وحدة)`);
rx(/^On (.+)’s credit$/, (m, c) => `آجل على ${tr(c)}`);
rx(/^Only (\d+) of “(.+)” are available\.$/, (m, n, p) => `المتاح من «${p}» ${n} فقط.`);
rx(/^(\d+) credit payments? recorded for it will stay on the customer’s account and count toward their other open sales\.$/, (m, n) => `${n} دفعة سداد مسجلة له ستبقى في حساب العميل وتُحتسب على مبيعاته المفتوحة الأخرى.`);
rx(/^(.+) of (.+) paid$/, (m, a, b) => `دُفع ${a} من ${b}`);
rx(/^Overdue since (.+)$/, (m, d) => `متأخر منذ ${d}`);
rx(/^Due (.+)$/, (m, d) => `مستحق ${d}`);
rx(/^Owes (.+)$/, (m, a) => `متبقٍ ${a}`);
rx(/^incl\. (.+) extras$/, (m, a) => `شامل ${a} إضافات`);
rx(/^(\d+) sales?$/, (m, n) => `${n} عملية بيع`);
rx(/^owes (.+)$/, (m, a) => `عليه ${a}`);
rx(/^Sale of (.+)$/, (m, d) => `بيع بتاريخ ${d}`);
rx(/^(.+) owes$/, (m, c) => `على ${c}`);
rx(/^next due (.+?)(\.?)$/, (m, d, dot) => `الاستحقاق التالي ${d}${dot}`);
rx(/^(.+) only owes (.+)\. Enter at most that amount\.$/, (m, c, a) => `المتبقي على ${c} ${a} فقط. أدخل هذا المبلغ كحد أقصى.`);
rx(/^(\d+) customers?$/, (m, n) => `${n} عميل`);
rx(/^(\d+) recorded$/, (m, n) => `${n} مسجلة`);
rx(/^(.+) overdue$/, (m, a) => `${a} متأخرة`);
rx(/^(.+) not matched to any sale$/, (m, a) => `${a} غير مرتبطة بأي بيع`);
rx(/^from (.+)\. Changes here only affect this backup\.$/, (m, d) => `من ${d}. التغييرات هنا تؤثر على هذه النسخة فقط.`);
rx(/^\((.+)\)\. Changes here only affect this backup\.$/, (m, d) => `(${d}). التغييرات هنا تؤثر على هذه النسخة فقط.`);
rx(/^from (.+)$/, (m, c) => `من ${c}`);
rx(/^Sale (.+)$/, (m, s) => `بيع ${s}`);
/* ---- cloud: sign-in, sync, backups ---- */
Object.assign(AR, {
  'Wrong email or password. Check the user exists under Authentication → Users.': 'البريد الإلكتروني أو كلمة المرور غير صحيحة. تأكد من وجود المستخدم في Authentication → Users.',
  'Wrong email or password.': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'The Web API key is not valid. Copy it again from Project settings.': 'مفتاح Web API غير صالح. انسخه مجدداً من Project settings.',
  'Email/Password sign-in is not enabled yet (Authentication → Sign-in method).': 'تسجيل الدخول بالبريد وكلمة المرور غير مفعّل بعد (Authentication → Sign-in method).',
  'Too many attempts. Wait a few minutes and try again.': 'محاولات كثيرة. انتظر بضع دقائق ثم حاول مجدداً.', 'This user is disabled in Firebase.': 'هذا المستخدم معطّل في Firebase.',
  'Couldn’t reach Firebase. Check your internet connection. If you’re using the preview inside Dia, it may block network access; use the hosted copy of the app instead.': 'تعذّر الوصول إلى Firebase. تحقق من اتصالك بالإنترنت. إذا كنت تستخدم المعاينة داخل Dia فقد تمنع الاتصال؛ استخدم النسخة المنشورة من التطبيق.',
  'Your cloud login expired. Please connect again.': 'انتهت صلاحية تسجيل الدخول. يرجى تسجيل الدخول مجدداً.', 'Database not found. Check the database URL.': 'قاعدة البيانات غير موجودة. تحقق من رابطها.',
  'Signed out. Your data stays on this device.': 'تم تسجيل الخروج. بياناتك تبقى على هذا الجهاز.',
  'The backup could not be verified, so nothing was deleted.': 'تعذّر التحقق من النسخة الاحتياطية، لذا لم يُحذف شيء.', 'Manual backup': 'نسخة يدوية',
  'The live ledger is empty, so there is nothing to back up.': 'السجل المباشر فارغ، فلا يوجد ما يُنسخ.', 'That backup is empty, so nothing was restored.': 'هذه النسخة فارغة، لذا لم تتم الاستعادة.',
  '📦 You are looking at a': '📦 أنت تشاهد', 'backup': 'نسخة احتياطية', 'Restore this backup': 'استعادة هذه النسخة', 'Back to the live ledger': 'العودة إلى السجل المباشر',
  'Ledger in use:': 'السجل المستخدم:', 'Live (shared)': 'المباشر (المشترك)', 'Backup': 'نسخة احتياطية', 'Back up now': 'انسخ احتياطياً الآن', 'Loading backups…': 'جارٍ تحميل النسخ…',
  'No backups yet. One is made automatically before data is cleared or many entries are deleted at once.': 'لا توجد نسخ احتياطية بعد. تُنشأ نسخة تلقائياً قبل مسح البيانات أو حذف قيود كثيرة دفعة واحدة.',
  'Restore': 'استعادة', 'Syncing…': 'جارٍ المزامنة…', 'Shared in the cloud': 'مشترك في السحابة', 'Offline, will retry': 'غير متصل، ستتم إعادة المحاولة',
  'Cloud needs attention': 'السحابة تحتاج إلى تدخل', 'Cloud': 'السحابة', 'Sync now': 'زامن الآن', 'Email': 'البريد الإلكتروني', 'Password': 'كلمة المرور',
  'Shared online ledger': 'السجل المشترك على الإنترنت', 'Signed in as': 'مسجّل الدخول باسم', 'Sign out on this device': 'تسجيل الخروج من هذا الجهاز',
  'Sign in to the shared ledger': 'سجّل الدخول إلى السجل المشترك', 'Sign in': 'تسجيل الدخول', 'Admin: add a person or update the access rules': 'للمسؤول: إضافة شخص أو تحديث قواعد الوصول',
  'In the Firebase console open': 'في لوحة Firebase افتح', '. Enter the person’s email address and choose a password for them.': '. أدخل البريد الإلكتروني للشخص واختر له كلمة مرور.',
  'Type both email addresses below, copy the rules, paste them into': 'اكتب البريدين أدناه، انسخ القواعد، والصقها في', 'and press': 'ثم اضغط',
  'Send the person the app link with their email and password. That is all they need.': 'أرسل للشخص رابط التطبيق مع بريده وكلمة المرور. هذا كل ما يحتاجه.',
  'Your email': 'بريدك الإلكتروني', 'Friend’s email': 'بريد صديقك', 'Copy rules': 'نسخ القواعد',
  'Forgotten password: in Firebase open Users, click ⋮ next to the person and choose Reset password; they get an email to set a new one. Nothing in the ledger is lost.': 'نسيان كلمة المرور: في Firebase افتح Users، اضغط ⋮ بجانب الشخص واختر Reset password؛ سيصله بريد لتعيين كلمة جديدة. لا يُفقد شيء من السجل.',
  'Synced': 'تمت المزامنة', 'Disconnect this device from the shared cloud ledger?': 'فصل هذا الجهاز عن السجل المشترك في السحابة؟', 'Rules copied': 'تم نسخ القواعد',
  'Backing up…': 'جارٍ النسخ الاحتياطي…', 'Backup saved': 'تم حفظ النسخة الاحتياطية',
  'The current live data is saved as a backup first, so you can undo this.': 'تُحفظ البيانات الحالية كنسخة احتياطية أولاً، لذا يمكنك التراجع.',
  'Restoring…': 'جارٍ الاستعادة…', 'Backup restored to the live ledger': 'تمت استعادة النسخة إلى السجل المباشر', 'Opening…': 'جارٍ الفتح…',
  'Back on the live ledger': 'عدت إلى السجل المباشر', 'Backup opened': 'تم فتح النسخة الاحتياطية',
  'Clear all shipments, purchases, sales, expenses and transfers?': 'مسح كل الشحنات والمشتريات والمبيعات والمصروفات والتحويلات؟',
  'Clear all shipments, purchases, sales, expenses and transfers': 'مسح كل الشحنات والمشتريات والمبيعات والمصروفات والتحويلات',
  'Replace all data with sample data?': 'استبدال كل البيانات ببيانات تجريبية؟', 'Replace all data with sample data': 'استبدال كل البيانات ببيانات تجريبية',
  'A full copy of the current ledger is saved first. You can open it any time under Settings → Shared online ledger.': 'تُحفظ نسخة كاملة من السجل الحالي أولاً. يمكنك فتحها في أي وقت من الإعدادات ← السجل المشترك على الإنترنت.',
  'Done. A backup was saved first.': 'تم. حُفظت نسخة احتياطية أولاً.', 'Done.': 'تم.', 'A backup file of the current data will be downloaded first.': 'سيتم تنزيل ملف نسخة احتياطية من البيانات الحالية أولاً.',
  'Please type your email and password.': 'يرجى كتابة بريدك الإلكتروني وكلمة المرور.', 'Please type your full email address.': 'يرجى كتابة بريدك الإلكتروني كاملاً.', 'Signing in…': 'جارٍ تسجيل الدخول…',
  'Sign in to open the shared ledger': 'سجّل الدخول لفتح السجل المشترك', 'Use without signing in on this device': 'الاستخدام دون تسجيل الدخول على هذا الجهاز'
});
rx(/^Sign-in failed: (.+)$/, (m, c) => `فشل تسجيل الدخول: ${c}`);
rx(/^Permission denied\. Make sure the database rules list your email \((.+)\)\.$/, (m, e) => `تم رفض الوصول. تأكد أن قواعد قاعدة البيانات تتضمن بريدك (${e}).`);
rx(/^Cloud error: (.+)$/, (m, e) => `خطأ في السحابة: ${e}`);
rx(/^Couldn’t reach the cloud, so (nothing was deleted|no backup was made|nothing was restored)\. ?(.*)$/, (m, w, x) => `تعذّر الوصول إلى السحابة، لذا ${{ 'nothing was deleted': 'لم يُحذف شيء', 'no backup was made': 'لم تُنشأ نسخة احتياطية', 'nothing was restored': 'لم تتم الاستعادة' }[w]}. ${tr(x)}`.trim());
rx(/^Couldn’t reach the cloud\. ?(.*)$/, (m, x) => `تعذّر الوصول إلى السحابة. ${tr(x)}`.trim());
rx(/^Automatic backup before deleting (\d+) entries$/, (m, n) => `نسخة تلقائية قبل حذف ${n} قيد`);
rx(/^Automatic backup before restoring the backup from (.+)$/, (m, d) => `نسخة تلقائية قبل استعادة نسخة ${d}`);
rx(/^(\d+) entries$/, (m, n) => `${n} قيد`);
rx(/^by (.+)$/, (m, u) => `بواسطة ${u}`);
rx(/^\. Every change is sent within a second and pulled every 20 seconds, so you and (.+) see the same numbers\. The file on disk still works as an extra backup\.$/,
  (m, n) => `. يُرسل كل تغيير خلال ثانية ويُسحب كل 20 ثانية، لتريا أنت و${n} نفس الأرقام. ويبقى الملف على الجهاز نسخة احتياطية إضافية.`);
rx(/^Sign in so you and (.+) work on the same numbers from any phone or laptop\.$/, (m, n) => `سجّل الدخول لتعملا أنت و${n} على نفس الأرقام من أي هاتف أو حاسوب.`);
rx(/^Restore the backup from (.+)\?$/, (m, d) => `استعادة النسخة الاحتياطية من ${d}؟`);
rx(/^It replaces ALL shipments, purchases, sales, expenses, transfers and settings in the live ledger, for you and (.+)\.$/, (m, n) => `ستحل محل كل الشحنات والمشتريات والمبيعات والمصروفات والتحويلات والإعدادات في السجل المباشر، لك ولـ${n}.`);
rx(/^Welcome, (.+)$/, (m, n) => `أهلاً، ${n}`);
rx(/^Delete (.+)$/, (m, n) => `حذف ${tr(n)}`);

/* ---- data file ---- */
Object.assign(AR, {
  'This window can’t write files directly, so a copy was downloaded instead': 'هذه النافذة لا تكتب في الملفات مباشرة، لذا تم تنزيل نسخة بدلاً من ذلك',
  'Permission was not granted': 'لم يُمنح الإذن', 'File updated with your latest changes': 'تم تحديث الملف بآخر تغييراتك',
  'Could not read the file, try Open file': 'تعذّرت قراءة الملف، جرّب «فتح ملف»', 'Replace the data currently in the app with the file you picked?': 'استبدال البيانات الحالية في التطبيق بالملف الذي اخترته؟',
  'That file is not a valid ledger': 'هذا الملف ليس سجلاً صالحاً'
});
rx(/^Saved to (.+)$/, (m, f) => `تم الحفظ في ${f}`);
rx(/^Opened (.+)$/, (m, f) => `تم فتح ${f}`);
rx(/^Loaded latest data from (.+)$/, (m, f) => `تم تحميل أحدث البيانات من ${f}`);
rx(/^Imported (.+)$/, (m, f) => `تم استيراد ${f}`);
rx(/^Linked to (.+)\. Click to allow saving again\.$/, (m, f) => `مرتبط بـ ${f}. اضغط للسماح بالحفظ مجدداً.`);

/* ---- receipt import ---- */
Object.assign(AR, {
  'Every product line on the receipt becomes a purchase in the chosen box. Check the list, fix anything that looks off, then import.': 'كل سطر منتج في الفاتورة يصبح عملية شراء في الصندوق المختار. راجع القائمة وصحّح ما يلزم ثم استورد.',
  'Reading the receipt…': 'جارٍ قراءة الفاتورة…', 'Drag & drop the PDF here': 'اسحب ملف PDF وأفلته هنا', 'or': 'أو', 'Choose PDF receipt': 'اختر فاتورة PDF',
  'dm.de online invoices (“Rechnung”) and dm store eBons, as PDF. The file stays on your device.': 'فواتير dm.de الإلكترونية («Rechnung») وإيصالات eBon من متاجر dm بصيغة PDF. يبقى الملف على جهازك.',
  'Or paste the receipt text': 'أو الصق نص الفاتورة', 'Open the PDF, press ⌘A (Ctrl+A) then ⌘C (Ctrl+C), and paste here.': 'افتح ملف PDF، اضغط ⌘A (Ctrl+A) ثم ⌘C (Ctrl+C)، والصقه هنا.',
  'Paste the receipt text…': 'الصق نص الفاتورة…', 'Read text': 'قراءة النص', 'Content (g/ml)': 'المحتوى (جم/مل)', 'Per unit (after coupons)': 'للوحدة (بعد الكوبونات)',
  'Net content per unit from the receipt; packaging is added when splitting shipping': 'المحتوى الصافي للوحدة من الفاتورة؛ يُضاف التغليف عند تقسيم الشحن',
  'Use another receipt': 'استخدم فاتورة أخرى', 'Nothing selected to import': 'لم يتم اختيار شيء للاستيراد',
  'No product lines were found. Try pasting the receipt text instead. Photos or scans of paper receipts can’t be read; use the eBon PDF from the dm app.': 'لم يُعثر على أسطر منتجات. جرّب لصق نص الفاتورة. لا يمكن قراءة صور الإيصالات الورقية؛ استخدم ملف eBon من تطبيق dm.',
  'This PDF could not be read here (the PDF reader needs an internet connection and may be blocked in previews). Use “paste the receipt text” below instead.': 'تعذّرت قراءة ملف PDF هنا (قارئ PDF يحتاج إلى اتصال بالإنترنت وقد يُمنع في المعاينات). استخدم «الصق نص الفاتورة» أدناه.',
  'Drop the dm receipt': 'أفلت فاتورة dm', 'PDF invoice or eBon': 'فاتورة PDF أو eBon', 'drop it on a shipment card to add it to that box': 'أفلتها على بطاقة شحنة لإضافتها إلى ذلك الصندوق',
  'Replace the receipt you are checking with the one you dropped?': 'استبدال الفاتورة التي تراجعها بالتي أفلتّها؟', 'To load a data file, use Settings → Backup & sync.': 'لتحميل ملف بيانات، استخدم الإعدادات ← النسخ الاحتياطي والمزامنة.'
});
rx(/^Spread the coupon discount of (.+) over the products \(you paid (.+) instead of (.+)\)$/, (m, a, b, c) => `وزّع خصم الكوبونات ${a} على المنتجات (دفعت ${b} بدلاً من ${c})`);
rx(/^This receipt \((.+)\) looks like it was imported before\. Importing again will add the products twice\.$/, (m, r) => `يبدو أن هذه الفاتورة (${r}) استُوردت من قبل. الاستيراد مجدداً سيضيف المنتجات مرتين.`);
rx(/^Import (\d+) products$/, (m, n) => `استيراد ${n} منتج`);
rx(/^(\d+) products imported( into (.+))?$/, (m, n, x, b) => `تم استيراد ${n} منتج${b ? ' إلى ' + tr(b) : ''}`);
rx(/^Lines found add up to (.+), but the receipt says (.+)\. Some lines may be missing\.$/, (m, a, b) => `مجموع الأسطر ${a} بينما الفاتورة تقول ${b}. قد تكون بعض الأسطر ناقصة.`);
rx(/^(\d+) lines? with quantity 0 \(not delivered\) skipped\.$/, (m, n) => `تم تخطي ${n} سطر بكمية 0 (لم يُسلَّم).`);
rx(/^(\d+) lines? could not be read reliably\. Compare with the receipt\.$/, (m, n) => `تعذّرت قراءة ${n} سطر بدقة. قارن مع الفاتورة.`);
/* ---- barcode scanning ---- */
Object.assign(AR, {
  'Scan barcode': 'مسح الباركود', 'Scan a barcode': 'امسح باركود', 'Barcode': 'الباركود', 'Barcode (EAN)': 'الباركود (EAN)', 'Torch': 'الفلاش', 'Use': 'استخدام',
  'Starting the camera…': 'جارٍ تشغيل الكاميرا…', '…or type the number under the barcode': '…أو اكتب الرقم المكتوب تحت الباركود',
  'Hold the barcode inside the frame.': 'ضع الباركود داخل الإطار.', 'That number doesn’t look like a barcode. Check the digits.': 'هذا الرقم لا يبدو باركوداً. راجع الأرقام.',
  'This browser can’t use the camera. Type the number instead.': 'هذا المتصفح لا يستطيع استخدام الكاميرا. اكتب الرقم بدلاً من ذلك.',
  'The camera only works in the hosted app (https). Type the number instead.': 'الكاميرا تعمل فقط في النسخة المنشورة من التطبيق (https). اكتب الرقم بدلاً من ذلك.',
  'Camera access was blocked. Allow it in the browser settings, or type the number.': 'تم منع الوصول إلى الكاميرا. اسمح به من إعدادات المتصفح، أو اكتب الرقم.',
  'No camera found. Type the number instead.': 'لم يتم العثور على كاميرا. اكتب الرقم بدلاً من ذلك.',
  'The scanner couldn’t load (it needs an internet connection). Type the number instead.': 'تعذّر تحميل الماسح (يحتاج إلى اتصال بالإنترنت). اكتب الرقم بدلاً من ذلك.',
  'The scanner couldn’t start. Type the number instead.': 'تعذّر تشغيل الماسح. اكتب الرقم بدلاً من ذلك.',
  'in stock': 'في المخزون', 'Link more lines': 'ربط أسطر أخرى', 'Scan another': 'امسح منتجاً آخر', 'New barcode': 'باركود جديد', 'Back': 'رجوع',
  'Pick another product line that has this barcode, e.g. the same product named differently on another receipt.': 'اختر سطر منتج آخر يحمل هذا الباركود، مثل نفس المنتج باسم مختلف في فاتورة أخرى.',
  'This barcode isn’t linked to a product yet. Pick the product it belongs to; all its lines get the barcode, so the next scan finds it.': 'هذا الباركود غير مرتبط بمنتج بعد. اختر المنتج الذي ينتمي إليه؛ ستحصل كل أسطره على الباركود، فيجده المسح التالي.',
  'Search product or brand': 'ابحث عن منتج أو ماركة', 'Add as a new purchase': 'إضافة كمشتريات جديدة',
  'No product without a barcode matches.': 'لا يوجد منتج بلا باركود يطابق البحث.', 'Every product already has a barcode.': 'كل المنتجات لها باركود بالفعل.',
  'Optional. Scan or type it once; other lines of the same product get it too, so scanning finds the product later.': 'اختياري. امسحه أو اكتبه مرة واحدة؛ تحصل عليه أسطر نفس المنتج الأخرى أيضاً، فيجد المسح المنتج لاحقاً.',
  'That barcode doesn’t look right. Check the digits (8 or 13 numbers).': 'هذا الباركود لا يبدو صحيحاً. راجع الأرقام (8 أو 13 رقماً).',
  'Scan with the camera': 'امسح بالكاميرا', 'Scan to link this product': 'امسح لربط هذا المنتج', 'Link': 'ربط', 'Link it to this product too?': 'ربطه بهذا المنتج أيضاً؟',
  'Scan to sell': 'امسح للبيع', 'Scan products': 'امسح المنتجات', 'Scan the products': 'امسح المنتجات', 'Done': 'تم',
  'Find by scan': 'ابحث بالمسح', 'Find a product': 'ابحث عن منتج', 'barcode known': 'الباركود معروف',
  'This product was scanned before; the import links its barcode': 'تم مسح هذا المنتج من قبل؛ سيربط الاستيراد الباركود الخاص به'
});
Object.assign(AR, { 'Units': 'الوحدات', 'Lines': 'الأسطر', 'Back to top': 'العودة للأعلى', 'Version': 'الإصدار', 'A new version is available (': 'يتوفر إصدار جديد (', ').': ').', 'Reload': 'إعادة التحميل', 'Updating…': 'جارٍ التحديث…', 'Loading the shared ledger…': 'جارٍ تحميل السجل المشترك…', 'Getting your shipments, purchases and sales from the cloud.': 'جارٍ جلب الشحنات والمشتريات والمبيعات من السحابة.', 'This is taking longer than usual. Check the internet connection.': 'يستغرق هذا وقتاً أطول من المعتاد. تحقق من اتصال الإنترنت.', 'Try again': 'حاول مجدداً', 'In EGP': 'بالجنيه', 'Units left': 'الوحدات المتبقية', 'Entries': 'القيود' });
/* ---- Firestore ---- */
Object.assign(AR, {
  'Offline: changes are saved on this device and sent when the connection is back.': 'غير متصل: التغييرات محفوظة على هذا الجهاز وتُرسل عند عودة الاتصال.',
  'Offline, saved on this device': 'غير متصل، محفوظ على هذا الجهاز',
  'Moving the shared ledger to the new database…': 'جارٍ نقل السجل المشترك إلى قاعدة البيانات الجديدة…',
  'The shared ledger was moved to the new database': 'تم نقل السجل المشترك إلى قاعدة البيانات الجديدة',
  'The move to the new database could not be verified. It will be tried again.': 'تعذّر التحقق من النقل إلى قاعدة البيانات الجديدة. ستتم المحاولة مجدداً.',
  'Couldn’t load the cloud library. Check your internet connection.': 'تعذّر تحميل مكتبة السحابة. تحقق من اتصالك بالإنترنت.',
  'Please sign in again.': 'يرجى تسجيل الدخول مجدداً.',
  'The app now uses a new, faster database. Please sign in once more; nothing is lost.': 'يستخدم التطبيق الآن قاعدة بيانات جديدة وأسرع. يرجى تسجيل الدخول مرة أخرى؛ لن يُفقد شيء.',
  'Can’t reach Firestore. If this stays, check that the Firestore database was created (see “Admin” in Settings).': 'تعذّر الوصول إلى Firestore. إذا استمر ذلك، تأكد من إنشاء قاعدة بيانات Firestore (انظر «للمسؤول» في الإعدادات).',
  'The Firestore database hasn’t been created yet. See “Admin” below.': 'لم يتم إنشاء قاعدة بيانات Firestore بعد. انظر «للمسؤول» أدناه.',
  'Type both email addresses below and copy the rules. In': 'اكتب البريدين أدناه وانسخ القواعد. في', ', paste them and press': '، الصقها ثم اضغط',
  '. (First time only:': '. (أول مرة فقط:', ', a location in Europe, production mode.)': '، موقع في أوروبا، وضع الإنتاج.)'
});
rx(/^Firestore refused access\. Check that the Firestore database exists and its rules list your email \((.*)\)\. See “Admin” below\.$/, (m, e) => `رفض Firestore الوصول. تأكد من وجود قاعدة بيانات Firestore وأن قواعدها تتضمن بريدك (${e}). انظر «للمسؤول» أدناه.`);
rx(/^\. Changes appear on (.+)’s phone within seconds\. Without internet everything keeps working: changes are saved on this device and sent when the connection is back\. The file on disk still works as an extra backup\.$/,
  (m, n) => `. تظهر التغييرات على هاتف ${n} خلال ثوانٍ. بدون إنترنت يستمر كل شيء في العمل: تُحفظ التغييرات على هذا الجهاز وتُرسل عند عودة الاتصال. ويبقى الملف على الجهاز نسخة احتياطية إضافية.`);
rx(/^Couldn’t read the old database \((\d+)\)\.$/, (m, n) => `تعذّرت قراءة قاعدة البيانات القديمة (${n}).`);
rx(/^of (\d+)$/, (m, n) => `من ${n}`);
rx(/^(\d+) with a known barcode$/, (m, n) => `${n} بباركود معروف`);
/* Rossmann eBons and the store of a purchase */
rx(/^(\d+) selected$/, (m, n) => `${n} محدد`);
Object.assign(AR, { 'Select all': 'تحديد الكل', 'Select': 'تحديد', 'Sell selected': 'بيع المحدد', 'Clear selection': 'إلغاء التحديد' });
rx(/^(\d+) with a barcode$/, (m, n) => `${n} بباركود`);
rx(/^Rossmann eBon (.+)$/, (m, d) => `إيصال Rossmann ‎${d}`);
Object.assign(AR, {
  'Import receipt': 'استيراد فاتورة', 'Receipt': 'فاتورة', 'Drop the receipt': 'أفلت الفاتورة', 'Store': 'المتجر', 'All stores': 'كل المتاجر',
  'One product line from a receipt. Use “Save & add another” to enter a whole receipt.': 'سطر منتج واحد من فاتورة. استخدم «حفظ وإضافة آخر» لإدخال فاتورة كاملة.',
  'dm.de online invoices (“Rechnung”) and dm or Rossmann eBons, as PDF. The file stays on your device.': 'فواتير dm.de الإلكترونية («Rechnung») وإيصالات eBon من dm أو Rossmann بصيغة PDF. يبقى الملف على جهازك.',
  'No product lines were found. Try pasting the receipt text instead. Photos or scans of paper receipts can’t be read; use the eBon PDF from the dm or Rossmann app.': 'لم يُعثر على أسطر منتجات. جرّب لصق نص الفاتورة. لا يمكن قراءة صور الإيصالات الورقية؛ استخدم ملف eBon من تطبيق dm أو Rossmann.',
  'The receipt date wasn’t found. Check “Date bought”.': 'لم يُعثر على تاريخ الفاتورة. تحقق من «تاريخ الشراء».',
  'known product': 'منتج معروف', 'This barcode is already in the ledger; the product name was taken from there': 'هذا الباركود موجود في السجل بالفعل؛ أُخذ اسم المنتج من هناك'
});
Object.assign(AR, {
  'Check box': 'فحص الصندوق', 'Packing check': 'فحص التعبئة', 'Not bought for this box': 'لم يُشترَ لهذا الصندوق', 'Start again': 'البدء من جديد', 'Scan': 'مسح',
  'No barcode: count by hand or link it': 'بلا باركود: عُدّ يدوياً أو اربطه', 'One less': 'واحد أقل', 'One more': 'واحد أكثر',
  'Scan what goes in the box': 'امسح ما يدخل الصندوق', 'Clear all counts for this box?': 'مسح كل العدّ لهذا الصندوق؟', 'No products in this box.': 'لا توجد منتجات في هذا الصندوق.',
  'units checked': 'وحدة تم فحصها', 'everything is in the box': 'كل شيء في الصندوق',
  'Open Beauty Facts knows this barcode:': 'Open Beauty Facts يعرف هذا الباركود:', 'Search for it': 'ابحث عنه',
  'Filled in from Open Beauty Facts. Check it.': 'تم الملء من Open Beauty Facts. راجعه.',
  'Checking the shared ledger…': 'جارٍ التحقق من السجل المشترك…'
});
rx(/^(\d+) of (\d+)$/, (m, a, b) => `${a} من ${b}`);
rx(/^This device has (\d+) entr(?:y|ies) that (?:is|are) not in the shared ledger\.$/, (m, n) => `يوجد على هذا الجهاز ${n} قيد غير موجود في السجل المشترك.`);
rx(/^OK = add (?:it|them) to the shared ledger$/, () => 'موافق = أضفها إلى السجل المشترك');
rx(/^Cancel = use only the shared ledger on this device$/, () => 'إلغاء = استخدم السجل المشترك فقط على هذا الجهاز');
rx(/^(\d+) products? still missing$/, (m, n) => `${n} منتج ما زال ناقصاً`);
rx(/^(\d+) don’t belong here$/, (m, n) => `${n} لا تنتمي إلى هنا`);
rx(/^⚠ (.+): (\d+) scanned, only (\d+) bought for this box$/, (m, p, a, b) => `⚠ ${p}: تم مسح ${a}، والمشترى لهذا الصندوق ${b} فقط`);
rx(/^⚠ (.+) doesn’t belong in this box( \((.+)\))?$/, (m, p, x, b) => `⚠ ${p} لا ينتمي إلى هذا الصندوق${b ? ' (' + tr(b) + ')' : ''}`);
rx(/^(?:✓ )?(.+) · (\d+) in this sale$/, (m, p, n) => `${p} · ${n} في هذا البيع`);
rx(/^(?:✓ )?(.+) · (\d+\/\d+) packed$/, (m, p, n) => `${p} · ${n} في الصندوق`);
rx(/^(?:[⚠✓] )?(.+) · (Doesn’t belong in this box|None left in stock|Only \d+ bought for this box)$/, (m, p, x) => `${p} · ${tr(x)}`);
rx(/^Only (\d+) bought for this box$/, (m, n) => `المشترى لهذا الصندوق ${n} فقط`);
Object.assign(AR, { 'Flashlight': 'الكشاف', 'in this sale': 'في هذا البيع', 'packed': 'في الصندوق', 'None left in stock': 'لم يتبقَّ في المخزون', 'Doesn’t belong in this box': 'لا ينتمي إلى هذا الصندوق' });
rx(/^No “(.+)” left in stock$/, (m, p) => `لم يتبقَّ «${p}» في المخزون`);
rx(/^Scan the barcode of (.+)$/, (m, p) => `امسح باركود ${p}`);
rx(/^Barcode linked to “(.+)”$/, (m, p) => `تم ربط الباركود بـ«${p}»`);
rx(/^This barcode is already linked to “(.+)”\.$/, (m, p) => `هذا الباركود مرتبط بالفعل بـ«${p}».`);

/* ---------- engine ---------- */
/* applied to every translated piece: amounts as "1,250 ج.م", "+2 more" */
const arFix = s => s.replace(/(−?)EGP (\d[\d,.]*)/g, '$1$2 ج.م').replace(/\(EGP\)/g, '(ج.م)').replace(/\(EUR\)/g, '(€)').replace(/ \+(\d+) more\b/g, ' و$1 أخرى');
function trCore(c) {
  if (AR[c] !== undefined) return AR[c];
  let x = c.match(/^([+⇪↻]\s?)(.+)$/);
  if (x) { const r = trCore(x[2]); return r === null ? null : x[1] + r; }
  if ((x = c.match(/^(.+) \*$/))) { const r = trCore(x[1]); return r === null ? null : r + ' *'; }
  if ((x = c.match(/^(−?[\d.,]+) (k?g)$/))) return x[1] + (x[2] === 'kg' ? ' كجم' : ' جم');
  for (const [re, fn] of AR_RX) { const m = c.match(re); if (m) return arFix(fn(...m)); }
  if (/(^|\s)·(\s|$)/.test(c)) {
    const parts = c.split(/(\s*·\s*)/);
    const out = parts.map((p, i) => i % 2 || !p ? p : (trCore(p) ?? p)).join('');
    if (out !== c) return out;
  }
  const f = arFix(c); return f !== c ? f : null;
}
function tr(s) {
  if (LANG !== 'ar' || !s || !/[A-Za-z]/.test(s)) return s;
  const m = String(s).match(/^(\s*)([\s\S]*?)(\s*)$/), out = trCore(m[2].replace(/\s+/g, ' '));
  return out === null ? s : m[1] + out + m[3];
}
const trLines = s => String(s).split('\n').map(tr).join('\n');

const I18N_SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']), I18N_ATTRS = ['placeholder', 'title', 'aria-label'];
function trNode(n) {
  if (n.nodeType === 3) {
    const p = n.parentElement; if (!p || I18N_SKIP.has(p.nodeName) || p.closest('.notr')) return;
    const t = tr(n.data); if (t !== n.data) n.data = t; return;
  }
  if (n.nodeType !== 1 || I18N_SKIP.has(n.nodeName) || n.classList.contains('notr')) return;
  I18N_ATTRS.forEach(a => { const v = n.getAttribute(a); if (v) { const t = tr(v); if (t !== v) n.setAttribute(a, t); } });
  for (let c = n.firstChild; c; c = c.nextSibling) trNode(c);
}

/* language switch, in the sidebar and on the sign-in screen */
function langSwitch() {
  const d = document.createElement('div'); d.className = 'langsw notr';
  d.innerHTML = `<button type="button" data-lang="en"${LANG === 'en' ? ' class="on"' : ''}>English</button><button type="button" data-lang="ar" lang="ar"${LANG === 'ar' ? ' class="on"' : ''}>العربية</button>`;
  return d;
}
function ensureSwitch() {
  const r = document.querySelector('.rail'); if (r && !r.querySelector('.langsw')) r.appendChild(langSwitch());
  const g = document.querySelector('#gate .gatebox'); if (g && !g.querySelector('.langsw')) g.appendChild(langSwitch());
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lang]'); if (!b || b.dataset.lang === LANG) return;
  localStorage.setItem('shanta-lang', b.dataset.lang); location.reload();
});

if (LANG === 'ar') {
  document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl';
  /* dates: Arabic month names, Western digits */
  ['toLocaleDateString', 'toLocaleString', 'toLocaleTimeString'].forEach(k => {
    const o = Date.prototype[k];
    Date.prototype[k] = function (l, opt) { return o.call(this, l === 'en-GB' ? 'ar-EG-u-nu-latn' : l, opt); };
  });
  const oc = window.confirm.bind(window), oa = window.alert.bind(window);
  window.confirm = m => oc(trLines(m)); window.alert = m => oa(trLines(m));
  /* chart: translate the legend and draw it right to left */
  if (window.Chart) window.Chart = new Proxy(window.Chart, { construct(C, [el, cfg]) {
    (cfg.data.datasets || []).forEach(d => d.label = tr(d.label));
    const lg = (((cfg.options = cfg.options || {}).plugins = cfg.options.plugins || {}).legend = cfg.options.plugins.legend || {}); lg.rtl = true;
    return new C(el, cfg);
  } });
}
new MutationObserver(list => {
  if (LANG === 'ar') list.forEach(m => {
    if (m.type === 'characterData') trNode(m.target);
    else if (m.type === 'attributes') trNode(m.target);
    else m.addedNodes.forEach(trNode);
  });
  ensureSwitch();
}).observe(document.documentElement, LANG === 'ar' ? { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS } : { childList: true, subtree: true });
/* moving products between boxes */
rx(/^(\d+) products · (\d+) units$/, (m, a, b) => `${a} منتجات · ${b} وحدة`);
rx(/^of (\d+)$/, (m, n) => `من ${n}`);
rx(/^(?:✓ )?(\d+) units moved to (.+)$/, (m, n, b) => `تم نقل ${n} وحدة إلى ${b}`);
Object.assign(AR, {
  'Move to box': 'نقل إلى صندوق', 'Move to another box': 'النقل إلى صندوق آخر', 'Move to': 'النقل إلى',
  'Choose a box…': 'اختر صندوقًا…', '+ New box…': '+ صندوق جديد…', 'New box name': 'اسم الصندوق الجديد', 'Move': 'نقل',
  'One less': 'واحد أقل', 'One more': 'واحد أكثر', 'Don’t move': 'لا تنقل',
  'Sold units stay in their box. Shipping costs are split again by weight in both boxes.': 'الوحدات المباعة تبقى في صندوقها. تُوزَّع تكاليف الشحن من جديد حسب الوزن في الصندوقين.',
  'Choose the box to move them to.': 'اختر الصندوق المراد النقل إليه.', 'Give the new box a name.': 'أعطِ الصندوق الجديد اسمًا.',
  'Nothing to move: they are already in that box.': 'لا شيء للنقل: المنتجات موجودة في هذا الصندوق بالفعل.'
});
/* Ledger: paid by each */
rx(/^Products · (.+)$/, (m, s) => `منتجات · ${s}`);
rx(/^(\d+) units( · (\d+) receipts?)?$/, (m, n, x, r) => `${n} وحدة${r ? ` · ${r} فاتورة` : ''}`);
rx(/^To (.+)$/, (m, p) => `إلى ${p}`);
rx(/^Transfers to (.+)$/, (m, p) => `تحويلات إلى ${p}`);
Object.assign(AR, {
  'All movements': 'كل الحركات', 'Paid by each': 'مدفوعات كل شريك', 'Paid for the business': 'المدفوع للمشروع', 'Products': 'المنتجات', 'Costs': 'التكاليف',
  'Paid in EGP': 'المدفوع بالجنيه', 'Paid': 'المدفوع', 'Rate': 'السعر', 'EGP per €1': 'جنيه لكل €1', 'Cost': 'التكلفة',
  'Not in a box yet': 'ليست في صندوق بعد', 'Costs of sales': 'تكاليف المبيعات', 'delivery and other costs paid with a sale': 'التوصيل وتكاليف أخرى مدفوعة مع بيع',
  'General costs': 'تكاليف عامة', 'not tied to a box or a sale': 'غير مرتبطة بصندوق أو بيع', 'Transfers sent': 'التحويلات المرسلة',
  '· settling up, not counted above': '· تسوية، غير محسوبة أعلاه', 'Nothing paid yet.': 'لم يُدفع شيء بعد.'
});
Object.assign(AR, { 'paid in €': 'مدفوعة باليورو', 'paid in EGP': 'مدفوعة بالجنيه' });
rx(/^≈ (.+)$/, (m, v) => `≈ ${v}`);
