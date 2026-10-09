export function RecoveryCode({ code }: { code: string }) {
  return (
    <section className="content-panel">
      <h2>Save your recovery code</h2>
      <p>
        This code can reset your password and restore access to your crews. Keep
        it privately in a password manager. It is shown only here; a new code
        replaces the old one.
      </p>
      <label htmlFor="recovery-code">Recovery code</label>
      <textarea
        id="recovery-code"
        readOnly
        value={code}
        rows={3}
        onFocus={(event) => event.target.select()}
      />
      <button
        type="button"
        className="secondary"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob(['Team Mission Planner recovery code\n' + code], {
              type: 'text/plain',
            }),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = 'mission-planner-recovery.txt';
          link.click();
          URL.revokeObjectURL(url);
        }}
      >
        Download recovery code
      </button>
    </section>
  );
}
