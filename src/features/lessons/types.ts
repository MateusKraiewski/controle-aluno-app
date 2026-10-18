export type Attendance = 'unmarked' | 'attended' | 'absent';

export type Lesson = {
  id: number;
  subject: string;
  teacher: string | null;
  localDate: string;
  startMinute: number;
  durationMinutes: number;
  plannedContent: string | null;
  studiedContent: string | null;
  attendance: Attendance;
  createdAt: number;
};

export type NewLesson = Omit<Lesson, 'id' | 'studiedContent' | 'attendance' | 'createdAt'>;
