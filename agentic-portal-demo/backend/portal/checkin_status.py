from datetime import datetime, timedelta

from .models import Appointment

CHECKIN_WINDOW_DAYS = 7


def checkin_status(appt: Appointment, now: datetime | None = None) -> str:
    """not_available | available | in_progress | complete"""
    now = now or datetime.now()
    if appt.checkin is not None:
        return appt.checkin.status
    if appt.status != "scheduled" or not (now <= appt.start <= now + timedelta(days=CHECKIN_WINDOW_DAYS)):
        return "not_available"
    return "available"
