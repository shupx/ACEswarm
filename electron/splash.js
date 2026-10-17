window.startup.onStatus(({ message, error }) => {
  document.getElementById('status').textContent = message;
  if (error) {
    document.body.classList.add('failed');
    document.getElementById('heading').textContent = 'Unable to start ACEswarm.';
    document.querySelector('.subtitle').textContent = 'Please review the details below.';
    document.getElementById('note').textContent = 'Close ACEswarm and try again.';
    const details = document.getElementById('error');
    details.textContent = error;
    details.hidden = false;
    document.querySelector('.progress').removeAttribute('role');
  }
});
document.getElementById('quit').addEventListener('click', () => window.startup.quit());
