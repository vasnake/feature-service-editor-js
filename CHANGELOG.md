# feature-service-editor-js - Changelog

## Version 0.7.2 - Dec. 17, 2013

- Fixed Next/Prev page bug.

## Version 0.7.1 - Dec. 17, 2013

- Fixed Load/Reload bug.

## Version 0.7 - Dec. 10, 2013

- Grid row acions buttons removed. Since row actions (save, undo, delete) works only for Current Record, we need only three actions buttons.

## Version 0.6 - Dec. 10, 2013

- Editor now can work with any geometry type of feature service, not only Points.
- Fixed update record bug.
- Fixed revert/undo bug.
- Fixed delete bug.
- Removed Add New Record and Delete New Record buttons. This functionality is preposterous without graphic.geometry.
- Code revision shows that we still need to rewrite a lots of things.

## Version 0.5 - Dec. 3, 2013
- Fixed null attribute bug. If a null attribute existed the grid would fail to load.
- Fixed minor bugs related to how the library determined parameters from the Feature Service, for example it now uses the correct syntax to determine the Feature Service's spatialReference.
- **New:**
	- Added a pulldown list for URLs. Now the apps can be used to either manage multiple Feature Service, or you can still paste a URL into the field and click load.

## Version 0.4.1 - Aug. 5, 2013
- Fixed a memory leak whereby old dgrid click and dblclick listeners were not being properly destroyed when the grid was refreshed.

## Version 0.4 - Aug. 2, 2013
- **New:**
	- Add one new row of data at a time.
	- Delete one row of data at a time.
	- Stop feature service loading if geometry != "point". This app version only handles point based features.
	- Internal: Remove newly added local row from the store via removeNewLocalRecord().
	- Internal: Added a UI (user interface)namespace for helping to centralize major UI functions: featureEditor.ui
	- Internal: Added a boolean to _setListeners(true) to enable/disable ability to store the current row object in featureEditor.currentRow.

- **Minor Breaking Changes:**
	- Changed name of featureEditor.revertRecord to featureEditor.utils.revertLocalRecord. This makes way for future functionality that allows for reverting remote records and keeps utils reserved for local changes.
	- Renamed all div ids using the dash "-" pattern. Still have some renaming to do on other divs.

**NOTE**: This version does not provide complete field type validation when adding a new entry.

## Version 0.3.3 - June 26, 2013
- Disabled ability to double click on Save or Undo buttons.

## Version 0.3.2 - June 26, 2013
- Tightened up error correction when dedicated editable/non-editable fields.
- Improved some of the code comments.

## Version 0.3.1 - June 26, 2013
- Implemented ability to auto-detect if a feature's field is editable or not. If it is not editable then disable editing on that dgrid column.


## Version 0.3 - June 20, 2013

- Initial commit.
