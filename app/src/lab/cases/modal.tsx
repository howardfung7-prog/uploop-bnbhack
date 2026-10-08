/// Dialogs and overlays (§71.109).
///
/// A dialog is `position: fixed` itself, so one per cell in the gallery would cover the others. This group therefore draws
/// nothing but a toggle button by default; the dialog is mounted on click and closed with Esc / a click on the backdrop — one at a time.
/// It is still wrapped in `<Stage>`: selectors such as `.arena .modal { box-shadow: none }` (§71.105) key off an ancestor,
/// so a shadow seen outside `.arena` is a false reading.

import { useState } from "react";
import type { ReactNode } from "react";
import { FundsModal } from "../../components/Arena";
import { WalletPicker } from "../../components/WalletPicker";
import type { LabCase } from "../registry";
import { Stage } from "../Stage";
import * as F from "../fixtures";

/// A "click to open" shell. `inArena` decides whether the dialog lands inside `.arena` or outside it — the shadow rules differ.
function Toggle({ label, inArena = false, children }: { label: string; inArena?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const body = (
    <>
      <button type="button" className="lab-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Close" : label}
      </button>
      {open && children(() => setOpen(false))}
    </>
  );
  return <Stage>{inArena ? <div className="arena">{body}</div> : body}</Stage>;
}

const funds = (mode: "deposit" | "withdraw", over: Partial<Parameters<typeof FundsModal>[0]> = {}) => (
  <Toggle label={`Open the ${mode === "deposit" ? "deposit" : "withdraw"} dialog`}>
    {(close) => (
      <FundsModal
        mode={mode}
        funds={F.fundsOk()}
        account={F.account}
        busy={false}
        canWrite={false}
        source={F.sourceOk()}
        withdrawPaused={false}
        onClose={close}
        onDeposit={F.noop}
        onWithdraw={F.noop}
        onCancel={F.noop}
        {...over}
      />
    )}
  </Toggle>
);

export const modalCases: LabCase[] = [
  {
    id: "modal-deposit", group: "modal", name: "Deposit dialog · normal",
    note: "A dedicated deposit address plus the list of arrivals (§71.111). The address line needs a solid ground in the light theme (§71.103)",
    render: () => funds("deposit"),
  },
  {
    id: "modal-deposit-empty", group: "modal", name: "Deposit dialog · nothing has arrived yet",
    note: "The source is swapped for the all-empty one: the empty state of the arrivals list",
    render: () => funds("deposit", { source: F.sourceEmpty() }),
  },
  {
    id: "modal-deposit-fail", group: "modal", name: "Deposit dialog · the deposit address cannot be read",
    note: "depositAddress throws. Under no circumstances may an empty address box be shown for someone to transfer into",
    render: () => funds("deposit", { source: F.sourceFail() }),
  },
  {
    id: "modal-deposit-unavailable", group: "modal", name: "Deposit dialog · the custody backend is unavailable for now",
    note: "The endpoint did not fail; it returned address: null (§71.111). It has to say deposits are unavailable, and the transfer button must be grey",
    render: () => funds("deposit", { source: F.sourceNoAddress() }),
  },
  {
    id: "modal-withdraw", group: "modal", name: "Withdraw dialog · normal",
    render: () => funds("withdraw"),
  },
  {
    id: "modal-withdraw-zero", group: "modal", name: "Withdraw dialog · zero balance",
    note: "The request button should be disabled, and able to say why",
    render: () => funds("withdraw", { funds: F.fundsZero(), source: F.sourceEmpty() }),
  },
  {
    id: "modal-withdraw-paused", group: "modal", name: "Withdraw dialog · withdrawals paused",
    note: "withdrawPaused=true: grey button, reading that withdrawals are paused; requests already under review wait where they are and are not cancelled (§71.40)",
    render: () => funds("withdraw", { withdrawPaused: true, funds: F.fundsPending() }),
  },
  {
    id: "modal-wallet", group: "modal", name: "Wallet picker",
    note: "With no injected wallet installed there still has to be a way out (WalletConnect / go and install one) — never an empty list",
    render: () => (
      <Toggle label="Open the wallet picker">
        {(close) => <WalletPicker onClose={close} onPick={F.noopAsync} />}
      </Toggle>
    ),
  },
  {
    id: "modal-in-arena", group: "modal", name: "Dialog · landing inside .arena (no shadow)",
    note: "§71.105 removed every shadow inside the index-strategy arena. Compare this cell against the ones above: this one should have no shadow",
    render: () => (
      <Toggle label="Open a dialog (inside .arena)" inArena>
        {(close) => (
          <FundsModal
            mode="withdraw" funds={F.fundsOk()} account={F.account} busy={false} canWrite={false}
            source={F.sourceOk()} withdrawPaused={false}
            onClose={close} onDeposit={F.noop} onWithdraw={F.noop} onCancel={F.noop}
          />
        )}
      </Toggle>
    ),
  },
];
