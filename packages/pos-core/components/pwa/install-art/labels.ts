// Text drawn inside the "install the app" illustrations. Every string that
// appears in a scene comes from here, so the art follows the UI language.
// Values mirror the menu wording each OS / browser uses in that language.

export interface InstallArtLabels {
  install: string;
  cancel: string;
  add: string;
  pcInstallTip: string;
  copy: string;
  addBookmark: string;
  addToHomeScreen: string;
  safariMenu: string;
  file: string;
  edit: string;
  view: string;
  newWindow: string;
  newTab: string;
  androidNewTab: string;
  addToDock: string;
  bookmarks: string;
  history: string;
  installApp: string;
}

export const ART_LABELS: { th: InstallArtLabels; en: InstallArtLabels } = {
  th: {
    install: 'ติดตั้ง',
    cancel: 'ยกเลิก',
    add: 'เพิ่ม',
    pcInstallTip: 'ติดตั้ง Kafé OS',
    copy: 'คัดลอก',
    addBookmark: 'เพิ่มบุ๊กมาร์ก',
    addToHomeScreen: 'เพิ่มไปยังหน้าจอโฮม',
    safariMenu: 'Safari',
    file: 'ไฟล์',
    edit: 'แก้ไข',
    view: 'มุมมอง',
    newWindow: 'หน้าต่างใหม่',
    newTab: 'แถบใหม่',
    androidNewTab: 'แท็บใหม่',
    addToDock: 'เพิ่มไปยัง Dock…',
    bookmarks: 'บุ๊กมาร์ก',
    history: 'ประวัติ',
    installApp: 'ติดตั้งแอป',
  },
  en: {
    install: 'Install',
    cancel: 'Cancel',
    add: 'Add',
    pcInstallTip: 'Install Kafé OS',
    copy: 'Copy',
    addBookmark: 'Add Bookmark',
    addToHomeScreen: 'Add to Home Screen',
    safariMenu: 'Safari',
    file: 'File',
    edit: 'Edit',
    view: 'View',
    newWindow: 'New Window',
    newTab: 'New Tab',
    androidNewTab: 'New tab',
    addToDock: 'Add to Dock…',
    bookmarks: 'Bookmarks',
    history: 'History',
    installApp: 'Install app',
  },
};

export const ART_HOST = 'cafe-pos-sable.vercel.app';
