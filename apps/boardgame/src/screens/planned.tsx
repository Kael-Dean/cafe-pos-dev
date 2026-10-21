'use client';

// Placeholder screens for the board-game slots that are reserved but not built yet
// (lending, reservations, game library, board-game report). Same "P1 — coming next"
// treatment core uses for its own unbuilt screens.

import { PlaceholderScreen } from '@pos/core/components/screens/placeholders';

export function Lending() {
  return (
    <PlaceholderScreen title="ยืม–คืนเกม" icon="dice"
      subtitle="ยืมเกมจากคลังไปที่โต๊ะ • คืนเกม • เช็คชิ้นส่วน"
      sections={[
        { title: 'ยืมเกมเข้าโต๊ะ', desc: 'ผูกเกมกับ session ของโต๊ะ เห็นบนผังโต๊ะว่าเกมไหนอยู่โต๊ะไหน' },
        { title: 'คืนเกม + เช็คชิ้นส่วน', desc: 'checklist ชิ้นส่วนก่อนคืน บันทึกชิ้นหาย/เสียหาย' },
        { title: 'มัดจำ / ค่าปรับ', desc: 'ตั้งค่ามัดจำต่อเกม คิดรวมในบิลตอนปิดโต๊ะ' },
      ]}
    />
  );
}

export function Reservations() {
  return (
    <PlaceholderScreen title="จองโต๊ะ" icon="calendar"
      subtitle="จองล่วงหน้า • ปฏิทินโต๊ะ • เช็คอิน"
      sections={[
        { title: 'ปฏิทินการจอง', desc: 'ดูการจองรายวัน/รายสัปดาห์ต่อโต๊ะ กันจองซ้อน' },
        { title: 'เช็คอินเป็น session', desc: 'กดเช็คอินแล้วเปิดโต๊ะพร้อมแพ็กเกจเวลาที่จองไว้' },
        { title: 'มัดจำการจอง', desc: 'รับมัดจำ หักออกจากบิลตอนปิดโต๊ะ' },
      ]}
    />
  );
}

export function Library() {
  return (
    <PlaceholderScreen title="คลังเกม" icon="layers"
      subtitle="รายชื่อเกม • จำนวนผู้เล่น • สภาพเกม"
      sections={[
        { title: 'รายการเกม', desc: 'ชื่อ จำนวนผู้เล่น เวลาเล่น ความยาก ภาษา' },
        { title: 'สภาพ + ชิ้นส่วน', desc: 'รายการชิ้นส่วนต่อเกม ใช้ตอนคืนเกม' },
        { title: 'แนะนำเกม', desc: 'กรองเกมตามจำนวนคนในโต๊ะ ให้พนักงานแนะนำได้เร็ว' },
      ]}
    />
  );
}

export function BoardgameReport() {
  return (
    <PlaceholderScreen title="รายงานบอร์ดเกม" icon="chart"
      subtitle="รายได้ค่าเวลา • อัตราใช้โต๊ะ • เกมยอดนิยม"
      sections={[
        { title: 'รายได้ค่าเวลา vs อาหาร', desc: 'แยกยอดค่าโต๊ะกับยอดอาหาร/เครื่องดื่มต่อวัน' },
        { title: 'อัตราใช้โต๊ะ', desc: 'ชั่วโมงที่มีคนนั่ง / ชั่วโมงเปิดร้าน ต่อโต๊ะและต่อโซน' },
        { title: 'เกมยอดนิยม', desc: 'จำนวนครั้งที่ยืมต่อเกม (ต้องมีระบบยืม–คืนก่อน)' },
      ]}
    />
  );
}
