/**
 * BUSINESS HOURS CALCULATOR UTILITY
 * Calculates elapsed business time considering:
 * - Working days (Mon-Fri typically)
 * - Business hours (9 AM - 5 PM typically)
 * - Break hours (lunch breaks, etc.)
 * - Holidays
 * - Paused periods
 */

const { connectDB, sql } = require('../config/database');

class BusinessHoursCalculator {
  constructor() {
    this.scheduleCache = new Map();
    this.holidayCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes cache
  }

  /**
   * Load business hours schedule with details and breaks
   */
  async loadSchedule(scheduleId) {
    const cacheKey = `schedule_${scheduleId}`;
    const cached = this.scheduleCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    try {
      const pool = await connectDB();

      // Get schedule
      const scheduleResult = await pool.request()
        .input('scheduleId', sql.UniqueIdentifier, scheduleId)
        .query(`
          SELECT * FROM BUSINESS_HOURS_SCHEDULES WHERE schedule_id = @scheduleId
        `);

      if (scheduleResult.recordset.length === 0) {
        throw new Error('Schedule not found');
      }

      const schedule = scheduleResult.recordset[0];

      // Get day details
      const detailsResult = await pool.request()
        .input('scheduleId', sql.UniqueIdentifier, scheduleId)
        .query(`
          SELECT * FROM BUSINESS_HOURS_DETAILS WHERE schedule_id = @scheduleId ORDER BY day_of_week
        `);

      // Get breaks
      const breaksResult = await pool.request()
        .input('scheduleId', sql.UniqueIdentifier, scheduleId)
        .query(`
          SELECT * FROM BREAK_HOURS WHERE schedule_id = @scheduleId AND is_active = 1
        `);

      const data = {
        ...schedule,
        details: detailsResult.recordset,
        breaks: breaksResult.recordset
      };

      this.scheduleCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error('Error loading schedule:', error);
      throw error;
    }
  }

  /**
   * Load holidays for a calendar
   */
  async loadHolidays(calendarId) {
    if (!calendarId) return [];

    const cacheKey = `holidays_${calendarId}`;
    const cached = this.holidayCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('calendarId', sql.UniqueIdentifier, calendarId)
        .query(`
          SELECT * FROM HOLIDAY_DATES WHERE calendar_id = @calendarId ORDER BY holiday_date
        `);

      const data = result.recordset.map(h => ({
        ...h,
        holiday_date: new Date(h.holiday_date)
      }));

      this.holidayCache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error('Error loading holidays:', error);
      return [];
    }
  }

  /**
   * Check if a date is a holiday
   */
  isHoliday(date, holidays) {
    const dateStr = this.formatDateOnly(date);
    return holidays.find(h => this.formatDateOnly(h.holiday_date) === dateStr);
  }

  /**
   * Format date to YYYY-MM-DD
   */
  formatDateOnly(date) {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  }

  /**
   * Get working hours configuration for a specific day
   */
  getDayConfig(schedule, dayOfWeek) {
    if (schedule.is_24x7) {
      return {
        is_working_day: true,
        start_time: '00:00:00',
        end_time: '24:00:00'  // Full day (1440 minutes)
      };
    }

    const dayConfig = schedule.details.find(d => d.day_of_week === dayOfWeek);
    return dayConfig || { is_working_day: false };
  }

  /**
   * Parse time string or Date object to minutes from midnight
   */
  timeToMinutes(timeStr) {
    if (!timeStr) return 0;

    // Handle Date object (returned by SQL Server for TIME columns)
    if (timeStr instanceof Date) {
      return timeStr.getUTCHours() * 60 + timeStr.getUTCMinutes();
    }

    // Handle string format "HH:mm" or "HH:mm:ss"
    if (typeof timeStr === 'string') {
      const [hours, minutes] = timeStr.split(':').map(Number);
      // Handle 24:00 as end of day (1440 minutes)
      return hours * 60 + (minutes || 0);
    }

    return 0;
  }

  /**
   * Get breaks applicable for a day
   */
  getBreaksForDay(schedule, dayOfWeek) {
    if (!schedule.breaks || schedule.breaks.length === 0) return [];

    return schedule.breaks.filter(brk => {
      if (!brk.applies_to_days) return true;
      const days = brk.applies_to_days.split(',').map(Number);
      return days.includes(dayOfWeek);
    });
  }

  /**
   * Calculate working minutes in a day excluding breaks
   */
  calculateDayWorkingMinutes(schedule, dayOfWeek) {
    const dayConfig = this.getDayConfig(schedule, dayOfWeek);

    if (!dayConfig.is_working_day) return 0;

    const startMinutes = this.timeToMinutes(dayConfig.start_time);
    const endMinutes = this.timeToMinutes(dayConfig.end_time);
    let totalMinutes = endMinutes - startMinutes;

    // Subtract breaks
    const breaks = this.getBreaksForDay(schedule, dayOfWeek);
    for (const brk of breaks) {
      const breakStart = this.timeToMinutes(brk.start_time);
      const breakEnd = this.timeToMinutes(brk.end_time);

      // Only subtract break if it falls within working hours
      const effectiveStart = Math.max(breakStart, startMinutes);
      const effectiveEnd = Math.min(breakEnd, endMinutes);

      if (effectiveEnd > effectiveStart) {
        totalMinutes -= (effectiveEnd - effectiveStart);
      }
    }

    return Math.max(0, totalMinutes);
  }

  /**
   * Calculate elapsed business minutes between two dates
   * @param {Date} startDate - Start datetime
   * @param {Date} endDate - End datetime
   * @param {string} scheduleId - Business hours schedule ID
   * @param {string} calendarId - Holiday calendar ID
   * @param {Array} pausePeriods - Array of {pause_start, pause_end} objects
   */
  async calculateElapsedMinutes(startDate, endDate, scheduleId, calendarId, pausePeriods = []) {
    const schedule = await this.loadSchedule(scheduleId);
    const holidays = await this.loadHolidays(calendarId);

    let totalMinutes = 0;
    let currentDate = new Date(startDate);
    const end = new Date(endDate);

    while (currentDate < end) {
      const dayOfWeek = currentDate.getDay();
      const holiday = this.isHoliday(currentDate, holidays);
      const dayConfig = this.getDayConfig(schedule, dayOfWeek);

      // Skip if holiday (full day) or non-working day
      if ((holiday && holiday.is_full_day) || !dayConfig.is_working_day) {
        // Move to next day at midnight
        currentDate = new Date(currentDate);
        currentDate.setDate(currentDate.getDate() + 1);
        currentDate.setHours(0, 0, 0, 0);
        continue;
      }

      // Calculate minutes for this day
      const dayMinutes = this.calculateWorkingMinutesForPeriod(
        currentDate,
        end,
        dayConfig,
        schedule,
        dayOfWeek,
        holiday,
        pausePeriods
      );

      totalMinutes += dayMinutes;

      // Move to next day
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(0, 0, 0, 0);
    }

    return totalMinutes;
  }

  /**
   * Calculate working minutes for a specific period within a day
   */
  calculateWorkingMinutesForPeriod(startDate, endDate, dayConfig, schedule, dayOfWeek, holiday, pausePeriods) {
    const dayStart = new Date(startDate);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Get working hours boundaries
    const workStartMinutes = this.timeToMinutes(dayConfig.start_time);
    const workEndMinutes = this.timeToMinutes(dayConfig.end_time);

    // Calculate actual period boundaries within this day
    const periodStart = new Date(Math.max(startDate.getTime(), dayStart.getTime()));
    const periodEnd = new Date(Math.min(endDate.getTime(), dayEnd.getTime()));

    const periodStartMinutes = periodStart.getHours() * 60 + periodStart.getMinutes();
    // Handle midnight (day boundary) - when periodEnd equals dayEnd, it's midnight of the next day
    // which should be treated as 1440 (24*60) minutes of the current day
    let periodEndMinutes = periodEnd.getHours() * 60 + periodEnd.getMinutes();
    if (periodEnd.getTime() === dayEnd.getTime() && periodEndMinutes === 0) {
      periodEndMinutes = 24 * 60; // 1440 minutes
    }

    // Clamp to working hours
    const effectiveStart = Math.max(periodStartMinutes, workStartMinutes);
    const effectiveEnd = Math.min(periodEndMinutes, workEndMinutes);

    if (effectiveEnd <= effectiveStart) return 0;

    let minutes = effectiveEnd - effectiveStart;

    // Subtract breaks
    const breaks = this.getBreaksForDay(schedule, dayOfWeek);
    for (const brk of breaks) {
      const breakStart = this.timeToMinutes(brk.start_time);
      const breakEnd = this.timeToMinutes(brk.end_time);

      // Calculate overlap between break and effective period
      const overlapStart = Math.max(breakStart, effectiveStart);
      const overlapEnd = Math.min(breakEnd, effectiveEnd);

      if (overlapEnd > overlapStart) {
        minutes -= (overlapEnd - overlapStart);
      }
    }

    // Subtract partial holiday (if applicable)
    if (holiday && !holiday.is_full_day) {
      const holidayStart = this.timeToMinutes(holiday.start_time);
      const holidayEnd = this.timeToMinutes(holiday.end_time);

      const overlapStart = Math.max(holidayStart, effectiveStart);
      const overlapEnd = Math.min(holidayEnd, effectiveEnd);

      if (overlapEnd > overlapStart) {
        minutes -= (overlapEnd - overlapStart);
      }
    }

    // Subtract paused periods
    for (const pause of pausePeriods) {
      if (!pause.pause_start || !pause.pause_end) continue;

      const pauseStart = new Date(pause.pause_start);
      const pauseEnd = new Date(pause.pause_end);

      // Check if pause overlaps with this day
      if (pauseEnd <= dayStart || pauseStart >= dayEnd) continue;

      const pauseStartMinutes = pauseStart >= dayStart
        ? pauseStart.getHours() * 60 + pauseStart.getMinutes()
        : 0;
      const pauseEndMinutes = pauseEnd < dayEnd
        ? pauseEnd.getHours() * 60 + pauseEnd.getMinutes()
        : 24 * 60;

      const overlapStart = Math.max(pauseStartMinutes, effectiveStart);
      const overlapEnd = Math.min(pauseEndMinutes, effectiveEnd);

      if (overlapEnd > overlapStart) {
        minutes -= (overlapEnd - overlapStart);
      }
    }

    return Math.max(0, minutes);
  }

  /**
   * Calculate deadline datetime from start date plus TAT minutes
   * @param {Date} startDate - Start datetime
   * @param {number} tatMinutes - TAT in business minutes
   * @param {string} scheduleId - Business hours schedule ID
   * @param {string} calendarId - Holiday calendar ID
   */
  async calculateDeadline(startDate, tatMinutes, scheduleId, calendarId) {
    const schedule = await this.loadSchedule(scheduleId);
    const holidays = await this.loadHolidays(calendarId);

    let remainingMinutes = tatMinutes;
    let currentDate = new Date(startDate);

    // Find the first working moment
    currentDate = this.findNextWorkingMoment(currentDate, schedule, holidays);

    while (remainingMinutes > 0) {
      const dayOfWeek = currentDate.getDay();
      const holiday = this.isHoliday(currentDate, holidays);
      const dayConfig = this.getDayConfig(schedule, dayOfWeek);

      // Skip if holiday (full day) or non-working day
      if ((holiday && holiday.is_full_day) || !dayConfig.is_working_day) {
        currentDate.setDate(currentDate.getDate() + 1);
        currentDate.setHours(0, 0, 0, 0);
        currentDate = this.findNextWorkingMoment(currentDate, schedule, holidays);
        continue;
      }

      const workEndMinutes = this.timeToMinutes(dayConfig.end_time);
      const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();

      // Calculate remaining working minutes in this day
      let availableMinutes = workEndMinutes - currentMinutes;

      // Subtract remaining breaks for today
      const breaks = this.getBreaksForDay(schedule, dayOfWeek);
      for (const brk of breaks) {
        const breakStart = this.timeToMinutes(brk.start_time);
        const breakEnd = this.timeToMinutes(brk.end_time);

        if (breakStart >= currentMinutes && breakEnd <= workEndMinutes) {
          availableMinutes -= (breakEnd - breakStart);
        } else if (breakStart < currentMinutes && breakEnd > currentMinutes) {
          // Currently in a break, skip to end of break
          availableMinutes -= (breakEnd - currentMinutes);
        }
      }

      if (availableMinutes >= remainingMinutes) {
        // Deadline is today
        let targetMinutes = currentMinutes + remainingMinutes;

        // Account for breaks between now and target
        for (const brk of breaks) {
          const breakStart = this.timeToMinutes(brk.start_time);
          const breakEnd = this.timeToMinutes(brk.end_time);

          if (breakStart >= currentMinutes && breakStart < targetMinutes) {
            targetMinutes += (breakEnd - breakStart);
          }
        }

        const hours = Math.floor(targetMinutes / 60);
        const minutes = targetMinutes % 60;
        currentDate.setHours(hours, minutes, 0, 0);
        return currentDate;
      } else {
        remainingMinutes -= availableMinutes;
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
        currentDate.setHours(0, 0, 0, 0);
        currentDate = this.findNextWorkingMoment(currentDate, schedule, holidays);
      }
    }

    return currentDate;
  }

  /**
   * Find the next working moment from a given date
   */
  findNextWorkingMoment(date, schedule, holidays) {
    let current = new Date(date);
    let iterations = 0;
    const maxIterations = 365; // Prevent infinite loops

    while (iterations < maxIterations) {
      const dayOfWeek = current.getDay();
      const holiday = this.isHoliday(current, holidays);
      const dayConfig = this.getDayConfig(schedule, dayOfWeek);

      // Skip holidays and non-working days
      if ((holiday && holiday.is_full_day) || !dayConfig.is_working_day) {
        current.setDate(current.getDate() + 1);
        current.setHours(0, 0, 0, 0);
        iterations++;
        continue;
      }

      const workStartMinutes = this.timeToMinutes(dayConfig.start_time);
      const workEndMinutes = this.timeToMinutes(dayConfig.end_time);
      const currentMinutes = current.getHours() * 60 + current.getMinutes();

      // If before work start, move to work start
      if (currentMinutes < workStartMinutes) {
        const hours = Math.floor(workStartMinutes / 60);
        const minutes = workStartMinutes % 60;
        current.setHours(hours, minutes, 0, 0);
        return current;
      }

      // If after work end, move to next day
      if (currentMinutes >= workEndMinutes) {
        current.setDate(current.getDate() + 1);
        current.setHours(0, 0, 0, 0);
        iterations++;
        continue;
      }

      // Within working hours - check if in a break
      const breaks = this.getBreaksForDay(schedule, dayOfWeek);
      let inBreak = false;

      for (const brk of breaks) {
        const breakStart = this.timeToMinutes(brk.start_time);
        const breakEnd = this.timeToMinutes(brk.end_time);

        if (currentMinutes >= breakStart && currentMinutes < breakEnd) {
          // Move to end of break
          const hours = Math.floor(breakEnd / 60);
          const minutes = breakEnd % 60;
          current.setHours(hours, minutes, 0, 0);
          inBreak = true;
          break;
        }
      }

      if (!inBreak) {
        return current;
      }

      iterations++;
    }

    return current;
  }

  /**
   * Calculate SLA status based on elapsed time vs thresholds
   */
  calculateSlaStatus(elapsedMinutes, minTat, avgTat, maxTat) {
    if (elapsedMinutes >= maxTat) {
      return {
        status: 'breached',
        zone: 'red',
        percentUsed: Math.round((elapsedMinutes / maxTat) * 100),
        remainingMinutes: 0,
        overageMinutes: elapsedMinutes - maxTat
      };
    }

    if (elapsedMinutes >= avgTat) {
      return {
        status: 'critical',
        zone: 'orange',
        percentUsed: Math.round((elapsedMinutes / maxTat) * 100),
        remainingMinutes: maxTat - elapsedMinutes,
        overageMinutes: 0
      };
    }

    if (elapsedMinutes >= minTat) {
      return {
        status: 'warning',
        zone: 'yellow',
        percentUsed: Math.round((elapsedMinutes / maxTat) * 100),
        remainingMinutes: maxTat - elapsedMinutes,
        overageMinutes: 0
      };
    }

    return {
      status: 'on_track',
      zone: 'green',
      percentUsed: Math.round((elapsedMinutes / maxTat) * 100),
      remainingMinutes: maxTat - elapsedMinutes,
      overageMinutes: 0
    };
  }

  /**
   * Format minutes to human readable string
   */
  formatDuration(minutes) {
    if (minutes < 60) {
      return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours < 24) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    if (remainingHours === 0 && mins === 0) {
      return `${days}d`;
    }

    if (remainingHours === 0) {
      return `${days}d ${mins}m`;
    }

    return mins > 0 ? `${days}d ${remainingHours}h ${mins}m` : `${days}d ${remainingHours}h`;
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.scheduleCache.clear();
    this.holidayCache.clear();
  }
}

// Export singleton instance
module.exports = new BusinessHoursCalculator();
