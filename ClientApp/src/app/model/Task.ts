export interface ITask {
  age: number;
  sid: string;
  attributes: { [key: string]: string };
  assignmentStatus: string;
  dateCreated: string;
  // This is not complete
}
