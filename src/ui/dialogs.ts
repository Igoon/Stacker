// ui/dialogs.ts — modal konfirmasi (#confirmModal) & input kustom (#promptModal).
export interface PromptResult {
  value: string;
  value2?: string;
  account?: string;
}

export interface PromptOptions {
  title: string;
  hint?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  inputMode?: string;
  label2?: string;
  placeholder2?: string;
  defaultValue2?: string;
  inputMode2?: string;
  syncAccountLabel?: string;
  validate?: (res: PromptResult) => string | null;
}

export interface DialogController {
  askConfirm(
    msg: string,
    opts?: { title?: string; okText?: string; danger?: boolean }
  ): Promise<boolean>;
  closeConfirmModal(ok: boolean): void;
  askModalPrompt(opts: PromptOptions): Promise<PromptResult | null>;
  closePromptModal(res: PromptResult | null): void;
}

export function createDialogController(
  getAccounts: () => Promise<{ nama: string }[]>
): DialogController {
  const confirmModal = document.getElementById("confirmModal")!;
  const confirmTitleEl = document.getElementById("confirmTitle")!;
  const confirmMsgEl = document.getElementById("confirmMsg")!;
  const confirmCancelBtn = document.getElementById("confirmCancel") as HTMLButtonElement;
  const confirmOkBtn = document.getElementById("confirmOk") as HTMLButtonElement;
  let confirmResolve: ((ok: boolean) => void) | null = null;

  function closeConfirmModal(ok: boolean): void {
    confirmModal.hidden = true;
    const resolve = confirmResolve;
    confirmResolve = null;
    resolve?.(ok);
  }

  confirmCancelBtn.onclick = () => closeConfirmModal(false);
  confirmOkBtn.onclick = () => closeConfirmModal(true);

  function askConfirm(
    msg: string,
    opts: { title?: string; okText?: string; danger?: boolean } = {}
  ): Promise<boolean> {
    confirmTitleEl.textContent = opts.title ?? "Konfirmasi";
    confirmMsgEl.textContent = msg;
    confirmOkBtn.textContent = opts.okText ?? "Lanjut";
    confirmOkBtn.classList.toggle("danger", opts.danger ?? true);
    confirmModal.hidden = false;
    confirmOkBtn.focus();
    return new Promise((resolve) => {
      confirmResolve = resolve;
    });
  }

  const promptModal = document.getElementById("promptModal")!;
  const promptTitleEl = document.getElementById("promptTitle")!;
  const promptHintEl = document.getElementById("promptHint")!;
  const promptLabel1Text = document.getElementById("promptLabel1Text")!;
  const promptInputEl = document.getElementById("promptInput") as HTMLInputElement;
  const promptRow2El = document.getElementById("promptRow2")!;
  const promptLabel2Text = document.getElementById("promptLabel2Text")!;
  const promptInput2El = document.getElementById("promptInput2") as HTMLInputElement;
  const promptAccWrap = document.getElementById("promptAccWrap")!;
  const promptSyncAcc = document.getElementById("promptSyncAcc") as HTMLInputElement;
  const promptSyncLabel = document.getElementById("promptSyncLabel")!;
  const promptAccRow = document.getElementById("promptAccRow")!;
  const promptAccSel = document.getElementById("promptAccSel") as HTMLSelectElement;
  const promptMsgEl = document.getElementById("promptMsg")!;

  let promptResolve: ((res: PromptResult | null) => void) | null = null;
  let promptValidator: ((res: PromptResult) => string | null) | null = null;

  function closePromptModal(res: PromptResult | null): void {
    promptModal.hidden = true;
    const resolve = promptResolve;
    promptResolve = null;
    promptValidator = null;
    resolve?.(res);
  }

  promptSyncAcc.onchange = () => {
    promptAccRow.hidden = !promptSyncAcc.checked;
  };

  document.getElementById("promptCancel")!.onclick = () => closePromptModal(null);

  function submitPromptModal(): void {
    const res: PromptResult = {
      value: promptInputEl.value.trim(),
      value2: promptRow2El.hidden ? undefined : promptInput2El.value.trim(),
      account: !promptAccWrap.hidden && promptSyncAcc.checked ? promptAccSel.value : undefined,
    };
    if (promptValidator) {
      const err = promptValidator(res);
      if (err) {
        promptMsgEl.hidden = false;
        promptMsgEl.textContent = err;
        return;
      }
    }
    closePromptModal(res);
  }

  document.getElementById("promptOk")!.onclick = submitPromptModal;
  promptInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitPromptModal();
    }
  });
  promptInput2El.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitPromptModal();
    }
  });

  async function askModalPrompt(opts: PromptOptions): Promise<PromptResult | null> {
    promptTitleEl.textContent = opts.title;
    promptHintEl.textContent = opts.hint ?? "";
    promptHintEl.hidden = !opts.hint;
    promptLabel1Text.textContent = opts.label ?? "Nilai";
    promptInputEl.placeholder = opts.placeholder ?? "";
    promptInputEl.value = opts.defaultValue ?? "";
    promptInputEl.inputMode = opts.inputMode ?? "text";

    if (opts.label2) {
      promptRow2El.hidden = false;
      promptLabel2Text.textContent = opts.label2;
      promptInput2El.placeholder = opts.placeholder2 ?? "";
      promptInput2El.value = opts.defaultValue2 ?? "";
      promptInput2El.inputMode = opts.inputMode2 ?? "text";
    } else {
      promptRow2El.hidden = true;
      promptInput2El.value = "";
    }

    if (opts.syncAccountLabel) {
      const accs = await getAccounts();
      promptAccSel.replaceChildren();
      for (const a of accs) {
        const o = document.createElement("option");
        o.value = a.nama;
        o.textContent = a.nama;
        promptAccSel.appendChild(o);
      }
      promptSyncLabel.textContent = opts.syncAccountLabel;
      promptSyncAcc.checked = false;
      promptAccRow.hidden = true;
      promptAccWrap.hidden = accs.length === 0;
    } else {
      promptAccWrap.hidden = true;
      promptSyncAcc.checked = false;
      promptAccRow.hidden = true;
    }

    promptMsgEl.hidden = true;
    promptValidator = opts.validate ?? null;
    promptModal.hidden = false;
    promptInputEl.focus();
    promptInputEl.select();
    return new Promise((resolve) => {
      promptResolve = resolve;
    });
  }

  return { askConfirm, closeConfirmModal, askModalPrompt, closePromptModal };
}
