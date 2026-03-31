import Alert from "@blazejkustra/react-native-alert";
import * as Evolu from "@evolu/common";
import { createEvoluBinding } from "@evolu/react";
import { createRun, EvoluIdenticon } from "@evolu/react-native";
import { createEvoluDeps } from "@evolu/react-native/expo-sqlite";
import { type FC, Suspense, use, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const TodoId = Evolu.id("Todo");

const Schema = {
  todo: {
    id: TodoId,
    title: Evolu.NonEmptyTrimmedString100,
    isCompleted: Evolu.nullOr(Evolu.SqliteBoolean),
  },
};

const appName = Evolu.AppName.orThrow("react-expo-minimal");
const deps = createEvoluDeps();
const run = createRun(deps);
const evoluPromise: Promise<Evolu.Evolu<typeof Schema>> = run.orThrow(
  Evolu.createEvolu(Schema, {
    appName,
    appOwner: Evolu.testAppOwner,
    ...(process.env.NODE_ENV === "development" && {
      transports: [{ type: "WebSocket", url: "ws://localhost:4000" }],
    }),
  }),
);

const { EvoluContext, useEvolu, useQuery } = createEvoluBinding(Schema);

const createQuery = Evolu.createQueryBuilder(Schema);
const todosQuery = createQuery((db) =>
  db
    .selectFrom("todo")
    .select(["id", "title", "isCompleted"])
    .where("isDeleted", "is not", Evolu.sqliteTrue)
    .where("title", "is not", null)
    .$narrowType<{ title: Evolu.KyselyNotNull }>()
    .orderBy("createdAt"),
);

type TodosRow = typeof todosQuery.Row;

void evoluPromise.catch((error: unknown) => {
  console.error(error);
});

deps.evoluError.subscribe(() => {
  const error = deps.evoluError.get();
  if (!error) return;
  Alert.alert("Evolu error occurred", "Check the console for details.");
  console.error(error);
});

const parseTodoTitle = (value: string) =>
  Evolu.NonEmptyTrimmedString100.from(value.trim());

export default function Index(): React.ReactNode {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.maxWidthContainer}>
          <View style={styles.header}>
            <Text style={styles.title}>Minimal Todo App (Evolu + Expo)</Text>
          </View>
          <Suspense
            fallback={
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563eb" />
              </View>
            }
          >
            <App />
          </Suspense>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const App: FC = () => {
  const evolu = use(evoluPromise);

  return (
    <EvoluContext value={evolu}>
      <Todos />
      <OwnerActions />
    </EvoluContext>
  );
};

const Todos: FC = () => {
  const todos = useQuery(todosQuery);
  const { insert } = useEvolu();
  const [newTodoTitle, setNewTodoTitle] = useState("");

  const handleAddTodo = () => {
    const title = parseTodoTitle(newTodoTitle);
    if (!title.ok) {
      Alert.alert("Validation error", formatTypeError(title.error));
      return;
    }

    insert(
      "todo",
      { title: title.value },
      {
        onComplete: () => {
          setNewTodoTitle("");
        },
      },
    );
  };

  return (
    <View
      style={[styles.todosContainer, { paddingTop: todos.length > 0 ? 6 : 24 }]}
    >
      <View
        style={[
          styles.todosList,
          { display: todos.length > 0 ? "flex" : "none" },
        ]}
      >
        {todos.map((todo) => (
          <TodoItem key={todo.id} row={todo} />
        ))}
      </View>

      <View style={styles.addTodoContainer}>
        <TextInput
          style={styles.textInput}
          value={newTodoTitle}
          onChangeText={setNewTodoTitle}
          onSubmitEditing={handleAddTodo}
          placeholder="Add a new todo..."
          autoComplete="off"
          placeholderTextColor="gray"
          autoCorrect={false}
          returnKeyType="done"
        />
        <Button title="Add" onPress={handleAddTodo} variant="primary" />
      </View>
    </View>
  );
};

const TodoItem: FC<{
  row: TodosRow;
}> = ({ row: { id, title, isCompleted } }) => {
  const { update } = useEvolu();

  const handleToggleCompletedPress = () => {
    update("todo", {
      id,
      isCompleted: Evolu.booleanToSqliteBoolean(!isCompleted),
    });
  };

  const handleRenamePress = () => {
    Alert.prompt(
      "Edit todo",
      "Enter new title:",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (newTitle?: string) => {
            if (newTitle == null) return;

            const parsedTitle = parseTodoTitle(newTitle);
            if (!parsedTitle.ok) {
              Alert.alert(
                "Validation error",
                formatTypeError(parsedTitle.error),
              );
              return;
            }

            update("todo", { id, title: parsedTitle.value });
          },
        },
      ],
      "plain-text",
      title,
    );
  };

  const handleDeletePress = () => {
    update("todo", {
      id,
      isDeleted: Evolu.sqliteTrue,
    });
  };

  return (
    <View style={styles.todoItem}>
      <TouchableOpacity
        style={styles.todoCheckbox}
        onPress={handleToggleCompletedPress}
      >
        <View
          style={[styles.checkbox, isCompleted ? styles.checkboxChecked : null]}
        />
        <Text
          style={[
            styles.todoTitle,
            isCompleted ? styles.todoTitleCompleted : null,
          ]}
        >
          {title}
        </Text>
      </TouchableOpacity>

      <View style={styles.todoActions}>
        <Button title="Edit" onPress={handleRenamePress} />
        <Button title="Delete" onPress={handleDeletePress} />
      </View>
    </View>
  );
};

const OwnerActions: FC = () => {
  const evolu = useEvolu();
  const [showMnemonic, setShowMnemonic] = useState(false);

  const handleDownloadDatabasePress = async () => {
    try {
      const array = await evolu.exportDatabase();
      console.info("dbExported", { appName, bytes: array.byteLength });
      Alert.alert(
        "Database exported",
        `Exported ${array.byteLength} bytes. Wire file saving into a share sheet or filesystem plugin for production use.`,
      );
    } catch (error) {
      console.error("Failed to export database", error);
      Alert.alert(
        "Export failed",
        error instanceof Error ? error.message : "Unknown export error.",
      );
    }
  };

  return (
    <View style={styles.ownerCard}>
      <View style={styles.ownerHeader}>
        <EvoluIdenticon id={evolu.appOwner.id} size={40} />
        <View style={styles.ownerHeaderText}>
          <Text style={styles.ownerTitle}>App Owner</Text>
          <Text style={styles.ownerId}>{evolu.appOwner.id}</Text>
        </View>
      </View>

      <View style={styles.ownerActionsRow}>
        <Button
          title={showMnemonic ? "Hide Mnemonic" : "Show Mnemonic"}
          onPress={() => {
            setShowMnemonic((value) => !value);
          }}
        />
        <Button title="Export DB" onPress={handleDownloadDatabasePress} />
      </View>

      {showMnemonic ? (
        <Text selectable style={styles.mnemonic}>
          {evolu.appOwner.mnemonic}
        </Text>
      ) : null}
    </View>
  );
};

const Button: FC<{
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
}> = ({ title, onPress, variant = "secondary" }) => {
  const isPrimary = variant === "primary";
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.button,
        isPrimary ? styles.primaryButton : styles.secondaryButton,
      ]}
    >
      <Text
        style={
          isPrimary ? styles.primaryButtonText : styles.secondaryButtonText
        }
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
};

const formatTypeError = Evolu.createFormatTypeError<
  Evolu.MinLengthError | Evolu.MaxLengthError
>((error): string => {
  switch (error.type) {
    case "MinLength":
      return `Text must be at least ${error.min} character${error.min === 1 ? "" : "s"} long`;
    case "MaxLength":
      return `Text is too long (maximum ${error.max} characters)`;
  }
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f7fb",
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  maxWidthContainer: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  header: {
    paddingBottom: 16,
  },
  title: {
    textAlign: "center",
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  loadingContainer: {
    paddingVertical: 32,
  },
  todosContainer: {
    borderRadius: 16,
    backgroundColor: "#fff",
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  todosList: {
    gap: 10,
    marginBottom: 20,
  },
  todoItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  todoCheckbox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: "#9ca3af",
    borderRadius: 6,
    backgroundColor: "#fff",
  },
  checkboxChecked: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  todoTitle: {
    flex: 1,
    fontSize: 16,
    color: "#111827",
  },
  todoTitleCompleted: {
    color: "#6b7280",
    textDecorationLine: "line-through",
  },
  todoActions: {
    flexDirection: "row",
    gap: 8,
  },
  addTodoContainer: {
    flexDirection: "row",
    gap: 12,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#fff",
  },
  button: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButton: {
    backgroundColor: "#2563eb",
  },
  secondaryButton: {
    backgroundColor: "#e5e7eb",
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  secondaryButtonText: {
    color: "#374151",
    fontWeight: "600",
  },
  ownerCard: {
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: "#fff",
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  ownerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  ownerHeaderText: {
    flex: 1,
  },
  ownerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  ownerId: {
    marginTop: 2,
    fontSize: 12,
    color: "#6b7280",
  },
  ownerActionsRow: {
    marginTop: 16,
    flexDirection: "row",
    gap: 8,
  },
  mnemonic: {
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    padding: 12,
    color: "#374151",
    fontSize: 12,
  },
});
