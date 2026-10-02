(() => {
  const list = document.getElementById('event-list');
  if (!list || !window.HDS?.api) return;

  const style = document.createElement('style');
  style.textContent = `
    .event-delete {
      border-color: rgba(220, 80, 80, .65) !important;
      color: #ffb4b4 !important;
    }
    .event-delete:hover:not(:disabled) {
      border-color: rgba(255, 120, 120, .95) !important;
      background: rgba(130, 25, 25, .28) !important;
    }
  `;
  document.head.appendChild(style);

  async function deleteEventFromWebsite(button) {
    const eventId = String(button.dataset.eventId || '').trim();
    if (!eventId) return;

    const card = button.closest('.event-card');
    const title = card?.querySelector('h3')?.textContent?.trim() || 'this event';
    const confirmed = confirm(`Delete “${title}” from the Hollow Valley website?\n\nThis removes it from /events only. The Discord scheduled event will not be deleted.`);
    if (!confirmed) return;

    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'Deleting…';

    try {
      await window.HDS.api(`/api/events/admin/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
      });

      if (typeof events !== 'undefined' && Array.isArray(events)) {
        events = events.filter((event) => String(event.id) !== eventId);
      }
      if (typeof selectedAdminEvent !== 'undefined' && String(selectedAdminEvent?.id || '') === eventId) {
        selectedAdminEvent = null;
        if (typeof adminAttendance !== 'undefined') adminAttendance = [];
      }

      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof renderEvents === 'function') renderEvents();
      if (typeof renderAdminEventSelect === 'function') renderAdminEventSelect();
      if (typeof renderSelectedAdminEvent === 'function') renderSelectedAdminEvent();
      if (typeof renderAdminAttendance === 'function') renderAdminAttendance();

      const message = document.getElementById('event-admin-message');
      if (message) message.textContent = `“${title}” was removed from the website events page.`;
    } catch (error) {
      alert(error.message || 'Could not delete the event from the website.');
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function addDeleteButtons() {
    list.querySelectorAll('.event-manage-attendance[data-event-id]').forEach((manageButton) => {
      const actions = manageButton.closest('.event-card-actions');
      if (!actions || actions.querySelector('.event-delete')) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'small-button event-delete';
      button.dataset.eventId = manageButton.dataset.eventId;
      button.textContent = 'Delete event';
      button.addEventListener('click', () => deleteEventFromWebsite(button));
      actions.appendChild(button);
    });
  }

  const observer = new MutationObserver(addDeleteButtons);
  observer.observe(list, { childList: true, subtree: true });
  addDeleteButtons();
})();
