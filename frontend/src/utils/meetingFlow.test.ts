import { describe, expect, it } from 'vitest';
import type { Meeting } from '../types';
import {
  getMeetingJoinState,
  getMeetingStatusPresentation,
  validateMeetingForm,
} from './meetingFlow';

const baseMeeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 'meeting-1',
  orgId: 'org-1',
  organization_id: 'org-1',
  title: 'Planning',
  startTime: '2026-05-24T10:00:00.000Z',
  endTime: '2026-05-24T11:00:00.000Z',
  duration: 60,
  status: 'upcoming',
  attendees: [],
  createdBy: 'user-1',
  createdAt: '2026-05-23T10:00:00.000Z',
  updatedAt: '2026-05-23T10:00:00.000Z',
  ...overrides,
});

describe('meetingFlow helpers', () => {
  it('validates scheduled meeting form data with normalized start and end', () => {
    const result = validateMeetingForm({
      title: '  Sprint Planning  ',
      groupId: 'group-1',
      date: '2026-05-24',
      time: '10:00',
      endTime: '',
      now: new Date('2026-05-24T08:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe('Sprint Planning');
      expect(result.start.toISOString()).toBe('2026-05-24T10:00:00.000Z');
      expect(result.end.toISOString()).toBe('2026-05-24T11:00:00.000Z');
    }
  });

  it('rejects past starts and invalid end times before posting', () => {
    expect(validateMeetingForm({
      title: 'Retro',
      groupId: 'group-1',
      date: '2026-05-24',
      time: '07:00',
      now: new Date('2026-05-24T08:00:00.000Z'),
    })).toMatchObject({ ok: false, message: 'Không thể tạo cuộc họp trong quá khứ' });

    expect(validateMeetingForm({
      title: 'Retro',
      groupId: 'group-1',
      date: '2026-05-24',
      time: '10:00',
      endTime: '09:30',
      now: new Date('2026-05-24T08:00:00.000Z'),
    })).toMatchObject({ ok: false, message: 'Giờ kết thúc phải sau giờ bắt đầu' });
  });

  it('uses one join-window policy across meeting surfaces', () => {
    const meeting = baseMeeting({
      code: 'ABC-DEF-GHI',
      startTime: '2026-05-24T10:00:00.000Z',
      endTime: '2026-05-24T11:00:00.000Z',
    });

    expect(getMeetingJoinState(meeting, new Date('2026-05-24T09:44:00.000Z'))).toMatchObject({
      canJoin: false,
      label: 'Chưa tới giờ',
    });
    expect(getMeetingJoinState(meeting, new Date('2026-05-24T09:45:00.000Z'))).toMatchObject({
      canJoin: true,
      label: 'Vào phòng',
      href: '/room/ABC-DEF-GHI',
    });
    expect(getMeetingJoinState(baseMeeting({ id: '', code: undefined }), new Date('2026-05-24T09:45:00.000Z'))).toMatchObject({
      canJoin: false,
      label: 'Thiếu mã họp',
    });
    expect(getMeetingJoinState(baseMeeting({ status: 'completed' }), new Date('2026-05-24T09:45:00.000Z'))).toMatchObject({
      canJoin: false,
      label: 'Biên bản',
      href: '/meetings/meeting-1',
    });
  });

  it('does not present a completed meeting with no audio as ready recording', () => {
    const presentation = getMeetingStatusPresentation(
      baseMeeting({ status: 'completed', audioStatus: 'NONE', audioUrl: undefined }),
      new Date('2026-05-24T12:00:00.000Z'),
    );

    expect(presentation.label).toBe('Hoàn tất');
    expect(presentation.hasRecording).toBe(false);
  });
});
