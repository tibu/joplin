/* eslint-disable no-unused-vars */


const time = require('@joplin/lib/time').default;
const { sortedIds, createNTestNotes, asyncTest, fileContentEqual, setupDatabase, setupDatabaseAndSynchronizer, db, synchronizer, fileApi, sleep, clearDatabase, switchClient, syncTargetId, objectsEqual, checkThrowAsync } = require('./test-utils.js');
const Folder = require('@joplin/lib/models/Folder.js');
const Note = require('@joplin/lib/models/Note.js');
const Setting = require('@joplin/lib/models/Setting').default;
const BaseModel = require('@joplin/lib/BaseModel').default;
const ArrayUtils = require('@joplin/lib/ArrayUtils.js');
const shim = require('@joplin/lib/shim').default;

process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at models_Note_CustomSortOrder: Promise', p, 'reason:', reason);
});

async function allItems() {
	const folders = await Folder.all();
	const notes = await Note.all();
	return folders.concat(notes);
}

describe('models_Note_CustomSortOrder', function() {
	beforeEach(async (done) => {
		await setupDatabaseAndSynchronizer(1);
		await switchClient(1);
		done();
	});

	it('should set the order property when saving a note', asyncTest(async () => {
		const now = Date.now();
		const n1 = await Note.save({ title: 'testing' });
		expect(n1.order).toBeGreaterThanOrEqual(now);

		const n2 = await Note.save({ title: 'testing', order: 0 });
		expect(n2.order).toBe(0);
	}));

	it('should insert notes at the specified position (order 0)', asyncTest(async () => {
		// Notes always had an "order" property, but for a long time it wasn't used, and
		// set to 0. For custom sorting to work though, it needs to be set to some number
		// (which normally is the creation timestamp). So if the user tries to move notes
		// in the middle of other notes with order = 0, the order of all these notes is
		// initialised at this point.

		const folder1 = await Folder.save({});
		const folder2 = await Folder.save({});

		const notes1 = [];
		notes1.push(await Note.save({ order: 0, parent_id: folder1.id })); await time.msleep(2);
		notes1.push(await Note.save({ order: 0, parent_id: folder1.id })); await time.msleep(2);
		notes1.push(await Note.save({ order: 0, parent_id: folder1.id })); await time.msleep(2);

		const notes2 = [];
		notes2.push(await Note.save({ parent_id: folder2.id })); await time.msleep(2);
		notes2.push(await Note.save({ parent_id: folder2.id })); await time.msleep(2);

		const originalTimestamps = {};
		for (const n of notes1) {
			originalTimestamps[n.id] = {
				user_created_time: n.user_created_time,
				user_updated_time: n.user_updated_time,
			};
		}

		await Note.insertNotesAt(folder1.id, notes2.map(n => n.id), 1);

		const newNotes1 = [
			await Note.load(notes1[0].id),
			await Note.load(notes1[1].id),
			await Note.load(notes1[2].id),
		];

		// Check that timestamps haven't changed - moving a note should not change the user timestamps
		for (let i = 0; i < newNotes1.length; i++) {
			const n = newNotes1[i];
			expect(n.user_created_time).toBe(originalTimestamps[n.id].user_created_time);
			expect(n.user_updated_time).toBe(originalTimestamps[n.id].user_updated_time);
		}

		const sortedNotes = await Note.previews(folder1.id, {
			order: Note.customOrderByColumns(),
		});

		expect(sortedNotes.length).toBe(5);
		expect(sortedNotes[0].id).toBe(notes1[2].id);
		expect(sortedNotes[1].id).toBe(notes2[0].id);
		expect(sortedNotes[2].id).toBe(notes2[1].id);
		expect(sortedNotes[3].id).toBe(notes1[1].id);
		expect(sortedNotes[4].id).toBe(notes1[0].id);
	}));

	it('should insert notes at the specified position (targets with same orders)', asyncTest(async () => {
		// If the target notes all have the same order, inserting a note should work
		// anyway, because the order of the other notes will be updated as needed.

		const folder1 = await Folder.save({});

		const notes = [];
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);

		await Note.insertNotesAt(folder1.id, [notes[0].id], 1);

		const sortedNotes = await Note.previews(folder1.id, {
			order: Note.customOrderByColumns(),
		});

		expect(sortedNotes.length).toBe(4);
		expect(sortedNotes[0].id).toBe(notes[3].id);
		expect(sortedNotes[1].id).toBe(notes[0].id);
		expect(sortedNotes[2].id).toBe(notes[2].id);
		expect(sortedNotes[3].id).toBe(notes[1].id);
	}));

	it('should insert notes at the specified position (insert at end)', asyncTest(async () => {
		const folder1 = await Folder.save({});

		const notes = [];
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);

		await Note.insertNotesAt(folder1.id, [notes[1].id], 4);

		const sortedNotes = await Note.previews(folder1.id, {
			fields: ['id', 'order', 'user_created_time'],
			order: Note.customOrderByColumns(),
		});

		expect(sortedNotes.length).toBe(4);
		expect(sortedNotes[0].id).toBe(notes[3].id);
		expect(sortedNotes[1].id).toBe(notes[2].id);
		expect(sortedNotes[2].id).toBe(notes[0].id);
		expect(sortedNotes[3].id).toBe(notes[1].id);
	}));

	it('should insert notes at the specified position (insert at beginning)', asyncTest(async () => {
		const folder1 = await Folder.save({});

		const notes = [];
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);

		await Note.insertNotesAt(folder1.id, [notes[2].id], 0);

		const sortedNotes = await Note.previews(folder1.id, {
			fields: ['id', 'order', 'user_created_time'],
			order: Note.customOrderByColumns(),
		});

		expect(sortedNotes.length).toBe(4);
		expect(sortedNotes[0].id).toBe(notes[2].id);
		expect(sortedNotes[1].id).toBe(notes[3].id);
		expect(sortedNotes[2].id).toBe(notes[1].id);
		expect(sortedNotes[3].id).toBe(notes[0].id);
	}));

	it('should insert notes even if sources are not adjacent', asyncTest(async () => {
		const folder1 = await Folder.save({});

		const notes = [];
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);
		notes.push(await Note.save({ order: 1000, parent_id: folder1.id })); await time.msleep(2);

		await Note.insertNotesAt(folder1.id, [notes[1].id, notes[3].id], 0);

		const sortedNotes = await Note.previews(folder1.id, {
			fields: ['id', 'order', 'user_created_time'],
			order: Note.customOrderByColumns(),
		});

		expect(sortedNotes.length).toBe(4);
		expect(sortedNotes[0].id).toBe(notes[1].id);
		expect(sortedNotes[1].id).toBe(notes[3].id);
		expect(sortedNotes[2].id).toBe(notes[2].id);
		expect(sortedNotes[3].id).toBe(notes[0].id);
	}));

});