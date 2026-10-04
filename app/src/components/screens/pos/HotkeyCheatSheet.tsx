'use client';

import { Fragment } from 'react';
import { Kbd, Modal } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

/** Every binding from UI-SPEC-core §4.1, grouped by scope. Keys are display labels. */
export function HotkeyCheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const h = t.pos.hotkeys;
  const groups: { title: string; rows: { keys: string[][]; label: string }[] }[] = [
    {
      title: h.groupGlobal,
      rows: [
        { keys: [['?']], label: h.cheatSheet },
        { keys: [['Ctrl', 'L']], label: h.lock },
        { keys: [['Esc']], label: h.closeTop },
      ],
    },
    {
      title: h.groupPos,
      rows: [
        { keys: [['/'], ['F2']], label: h.focusSearch },
        { keys: [['1'], ['…'], ['9']], label: h.addNth },
        { keys: [['['], [']']], label: h.prevNextCat },
        { keys: [['Enter']], label: h.searchEnter },
        { keys: [['↑'], ['↓']], label: h.searchMove },
        { keys: [['Alt', '↑'], ['Alt', '↓']], label: h.selectLine },
        { keys: [['+'], ['-']], label: h.lineQty },
        { keys: [['Delete']], label: h.lineRemove },
        { keys: [['E']], label: h.lineEdit },
        { keys: [['F4']], label: h.discount },
        { keys: [['F8']], label: h.customer },
        { keys: [['F9']], label: h.park },
        { keys: [['F12'], ['Ctrl', 'Enter']], label: h.charge },
        { keys: [['Ctrl', 'Backspace']], label: h.voidCart },
      ],
    },
    {
      title: h.groupPayment,
      rows: [
        { keys: [['Alt', '1'], ['Alt', '4']], label: h.payMethod },
        { keys: [['0–9'], ['.'], ['Backspace']], label: h.keypad },
        { keys: [['=']], label: h.exact },
        { keys: [['Enter']], label: h.confirm },
      ],
    },
    {
      title: h.groupReceipt,
      rows: [
        { keys: [['Enter'], ['N']], label: h.nextOrder },
        { keys: [['P']], label: h.print },
      ],
    },
    {
      title: h.groupKds,
      rows: [
        { keys: [['↑'], ['↓'], ['←'], ['→']], label: h.kdsMove },
        { keys: [['Space']], label: h.kdsAdvance },
        { keys: [['U']], label: h.kdsUndo },
      ],
    },
    {
      title: h.groupFloor,
      rows: [{ keys: [[h.typeTableName], ['Enter']], label: h.floorJump }],
    },
  ];

  return (
    <Modal open={open} onClose={onClose} title={h.title} description={h.subtitle} size="lg">
      <div className="pos-cheat">
        {groups.map((g) => (
          <section key={g.title} className="pos-cheat__group" aria-label={g.title}>
            <h3 className="pos-cheat__h">{g.title}</h3>
            <dl className="pos-cheat__list">
              {g.rows.map((r) => (
                <div key={r.label} className="pos-cheat__row">
                  <dt className="pos-cheat__keys">
                    {r.keys.map((combo, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span className="pos-cheat__or">{h.or}</span>}
                        {combo.map((k, j) => (
                          <Fragment key={j}>
                            {j > 0 && <span className="pos-cheat__plus" aria-hidden="true">+</span>}
                            <Kbd>{k}</Kbd>
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
                  </dt>
                  <dd className="pos-cheat__label">{r.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
