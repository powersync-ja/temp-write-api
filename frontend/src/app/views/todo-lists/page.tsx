import AddIcon from '@mui/icons-material/Add';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  styled
} from '@mui/material';
import Fab from '@mui/material/Fab';
import React from 'react';
import { v4 as uuid } from 'uuid';
import { NavigationPage } from '@/components/navigation/NavigationPage';
import { TodoListsWidget } from '@/components/widgets/TodoListsWidget';
import { useMutators } from '@/components/providers/SystemProvider';

export default function TodoListsPage() {
  const mutate = useMutators();

  const [showPrompt, setShowPrompt] = React.useState(false);
  const nameInputRef = React.createRef<HTMLInputElement>();

  const createNewList = async (name: string) => {
    await mutate.listCreate({ id: uuid(), name });
  };

  return (
    <NavigationPage title="Todo Lists">
      <Box>
        <S.FloatingActionButton onClick={() => setShowPrompt(true)}>
          <AddIcon />
        </S.FloatingActionButton>
        <Box>
          <TodoListsWidget />
        </Box>
        {/* TODO use a dialog service in future, this is just a simple example app */}
        <Dialog
          open={showPrompt}
          onClose={() => setShowPrompt(false)}
          PaperProps={{
            component: 'form',
            onSubmit: async (event: React.FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              await createNewList(nameInputRef.current!.value);
              setShowPrompt(false);
            }
          }}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description">
          <DialogTitle id="alert-dialog-title">{'Create Todo List'}</DialogTitle>
          <DialogContent>
            <DialogContentText id="alert-dialog-description">Enter a name for a new todo list</DialogContentText>
            <TextField sx={{ marginTop: '10px' }} fullWidth inputRef={nameInputRef} label="List Name" autoFocus />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowPrompt(false)}>Cancel</Button>
            <Button type="submit">Create</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </NavigationPage>
  );
}

namespace S {
  export const FloatingActionButton = styled(Fab)`
    position: absolute;
    bottom: 20px;
    right: 20px;
  `;
}
