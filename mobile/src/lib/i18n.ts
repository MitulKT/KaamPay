import type { Lang } from './types';

// Worker-facing strings are fully translated. Staff screens mostly use English with Hindi where helpful.
const S = {
  // login
  appTagline: { en: 'Job work, paid right', hi: 'सही काम, सही पैसा', gu: 'સાચું કામ, સાચા પૈસા' },
  mobileNumber: { en: 'Mobile number', hi: 'मोबाइल नंबर', gu: 'મોબાઇલ નંબર' },
  sendOtp: { en: 'Send OTP', hi: 'OTP भेजो', gu: 'OTP મોકલો' },
  enterOtp: { en: 'Enter OTP', hi: 'OTP डालो', gu: 'OTP નાખો' },
  verify: { en: 'Verify', hi: 'आगे बढ़ो', gu: 'આગળ વધો' },
  resendIn: { en: 'Resend in', hi: 'फिर से भेजो', gu: 'ફરી મોકલો' },
  resend: { en: 'Resend OTP', hi: 'OTP फिर भेजो', gu: 'OTP ફરી મોકલો' },
  changeNumber: { en: 'Change number', hi: 'नंबर बदलो', gu: 'નંબર બદલો' },
  newCompany: { en: 'New company? Register', hi: 'नई कंपनी? रजिस्टर करें', gu: 'નવી કંપની? રજિસ્ટર કરો' },
  chooseRole: { en: 'Continue as', hi: 'किस रूप में आगे बढ़ें', gu: 'કયા રૂપે આગળ વધો' },
  roleWORKER: { en: 'Worker', hi: 'कारीगर', gu: 'કારીગર' },
  roleSUPERVISOR: { en: 'Supervisor', hi: 'सुपरवाइज़र', gu: 'સુપરવાઇઝર' },
  roleADMIN: { en: 'Admin', hi: 'एडमिन', gu: 'એડમિન' },

  // worker tabs
  tabJobs: { en: 'Jobs', hi: 'काम', gu: 'કામ' },
  tabMoney: { en: 'Money', hi: 'पैसा', gu: 'પૈસા' },
  tabHistory: { en: 'History', hi: 'हिसाब', gu: 'હિસાબ' },
  namaste: { en: 'Namaste', hi: 'नमस्ते', gu: 'નમસ્તે' },
  pendingJobs: { en: 'Pending', hi: 'बाकी काम', gu: 'બાકી કામ' },
  doneToday: { en: 'Done today', hi: 'आज का काम', gu: 'આજનું કામ' },
  started: { en: 'Started', hi: 'शुरू किया', gu: 'શરૂ કર્યું' },
  done: { en: 'Done', hi: 'हो गया', gu: 'થઈ ગયું' },
  allDone: { en: 'All done', hi: 'सब हो गया', gu: 'બધું થઈ ગયું' },
  isComplete: { en: 'complete?', hi: 'पूरा हुआ?', gu: 'પૂરું થયું?' },
  yes: { en: 'Yes', hi: 'हाँ', gu: 'હા' },
  no: { en: 'No', hi: 'नहीं', gu: 'ના' },
  takePhoto: { en: 'Take photo', hi: 'फोटो लो', gu: 'ફોટો લો' },
  photoRequired: { en: 'Photo is required', hi: 'फोटो ज़रूरी है', gu: 'ફોટો જરૂરી છે' },
  undo: { en: 'Undo', hi: 'वापस लो', gu: 'પાછું લો' },
  noPendingJobs: { en: 'No pending jobs 🎉', hi: 'कोई काम बाकी नहीं 🎉', gu: 'કોઈ કામ બાકી નથી 🎉' },
  newJob: { en: 'New job', hi: 'नया काम', gu: 'નવું કામ' },
  st_ASSIGNED: { en: 'To do', hi: 'करना है', gu: 'કરવાનું છે' },
  st_STARTED: { en: 'Started', hi: 'शुरू', gu: 'શરૂ' },
  st_DONE: { en: 'Check pending', hi: 'चेक बाकी', gu: 'ચેક બાકી' },
  st_CHECKED: { en: 'Checked', hi: 'चेक हो गया', gu: 'ચેક થઈ ગયું' },
  st_APPROVED: { en: 'Approved', hi: 'अप्रूव्ड', gu: 'મંજૂર' },
  st_PAID: { en: 'Paid', hi: 'पैसा मिला', gu: 'પૈસા મળ્યા' },
  st_CANCELLED: { en: 'Cancelled', hi: 'रद्द', gu: 'રદ' },
  returned: { en: 'Returned', hi: 'वापस आया', gu: 'પાછું આવ્યું' },
  rr_QUALITY: { en: 'Quality issue', hi: 'क्वालिटी खराब', gu: 'ક્વોલિટી ખરાબ' },
  rr_WRONG_LOT: { en: 'Wrong lot', hi: 'गलत लॉट', gu: 'ખોટો લોટ' },
  rr_NOT_COMPLETED: { en: 'Not completed', hi: 'पूरा नहीं हुआ', gu: 'પૂરું નથી થયું' },
  rr_DUPLICATE: { en: 'Duplicate', hi: 'दोबारा एंट्री', gu: 'બીજી વાર એન્ટ્રી' },
  rr_OTHER: { en: 'Other', hi: 'अन्य', gu: 'અન્ય' },

  // money
  toReceive: { en: 'You will get', hi: 'आपको मिलना है', gu: 'તમને મળવાના છે' },
  youOwe: { en: 'Advance to recover', hi: 'एडवांस बाकी', gu: 'એડવાન્સ બાકી' },
  approvalPending: { en: 'Approval pending', hi: 'अप्रूवल बाकी', gu: 'મંજૂરી બાકી' },
  advanceTaken: { en: 'Advance taken', hi: 'एडवांस लिया', gu: 'એડવાન્સ લીધો' },
  earnedThisMonth: { en: 'Earned this month', hi: 'इस महीने कमाया', gu: 'આ મહિને કમાયા' },
  thisMonth: { en: 'This month', hi: 'इस महीने', gu: 'આ મહિને' },
  nextPayout: { en: 'Next payout', hi: 'अगला पेमेंट', gu: 'આગલું પેમેન્ટ' },
  settlements: { en: 'Settlements', hi: 'हिसाब', gu: 'હિસાબ' },
  advances: { en: 'Advances', hi: 'एडवांस', gu: 'એડવાન્સ' },
  gross: { en: 'Earned', hi: 'कमाई', gu: 'કમાણી' },
  advanceCut: { en: 'Advance cut', hi: 'एडवांस कटा', gu: 'એડવાન્સ કપાયો' },
  deductions: { en: 'Deductions', hi: 'कटौती', gu: 'કપાત' },
  paid: { en: 'Paid', hi: 'मिला', gu: 'મળ્યા' },
  balance: { en: 'Balance', hi: 'बाकी', gu: 'બાકી' },
  shareSlip: { en: 'Share slip', hi: 'स्लिप भेजो', gu: 'સ્લિપ મોકલો' },
  nothingYet: { en: 'Nothing yet', hi: 'अभी कुछ नहीं', gu: 'હજી કંઈ નથી' },

  // common
  profile: { en: 'Profile', hi: 'प्रोफ़ाइल', gu: 'પ્રોફાઇલ' },
  language: { en: 'Language', hi: 'भाषा', gu: 'ભાષા' },
  logout: { en: 'Logout', hi: 'लॉग आउट', gu: 'લૉગ આઉટ' },
  callSupervisor: { en: 'Call supervisor', hi: 'सुपरवाइज़र को कॉल', gu: 'સુપરવાઇઝરને કૉલ' },
  offline: { en: 'Offline – will sync', hi: 'ऑफलाइन – बाद में सिंक होगा', gu: 'ઑફલાઇન – પછી સિંક થશે' },
  pendingSync: { en: 'waiting to sync', hi: 'सिंक बाकी', gu: 'સિંક બાકી' },
  notifications: { en: 'Notifications', hi: 'सूचनाएँ', gu: 'સૂચનાઓ' },
  saved: { en: 'Saved', hi: 'सेव हो गया', gu: 'સેવ થયું' },
  lot: { en: 'LOT', hi: 'लॉट', gu: 'લોટ' },
  pickLot: { en: 'Pick lot', hi: 'लॉट चुनो', gu: 'લોટ પસંદ કરો' },
  pickWork: { en: 'Pick work', hi: 'काम चुनो', gu: 'કામ પસંદ કરો' },
  pickColour: { en: 'Pick colours', hi: 'कलर चुनो', gu: 'કલર પસંદ કરો' },
  confirm: { en: 'Confirm', hi: 'पक्का करो', gu: 'પાકું કરો' },
  back: { en: 'Back', hi: 'पीछे', gu: 'પાછળ' },
} as const;

export type Key = keyof typeof S;

let current: Lang = 'hi';
export const setLang = (l: Lang) => {
  current = l;
};
export const getLang = () => current;

export function t(key: Key | string, lang: Lang = current): string {
  const e = (S as Record<string, Record<Lang, string>>)[key];
  if (!e) return key;
  return e[lang] || e.en;
}

/** Work type name in the chosen language, falling back to English. */
export function wtName(j: { work_type_name_hi?: string; work_type_name_gu?: string; work_type_name_en?: string; work_type_code?: string }, lang: Lang = current): string {
  if (lang === 'hi' && j.work_type_name_hi) return j.work_type_name_hi;
  if (lang === 'gu' && j.work_type_name_gu) return j.work_type_name_gu;
  return j.work_type_name_en || j.work_type_code || '';
}

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'hi', label: 'हिन्दी' },
  { code: 'gu', label: 'ગુજરાતી' },
  { code: 'en', label: 'English' },
];
